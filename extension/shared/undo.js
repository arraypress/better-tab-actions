/**
 * Remembers the last batch of tabs an action closed, so it can be reopened in one go.
 * Stored in chrome.storage.session: survives the service worker sleeping, cleared when Chrome quits.
 *
 * Incognito tabs are never remembered, as Chrome itself keeps no closed tabs for incognito
 * windows: their addresses would outlive the incognito window, and reopen in an ordinary one.
 *
 * @module shared/undo
 */
import { MAX_URL, tabUrl } from './sites.js';

/** @import { StorageArea } from '../vendor/extension-kit/settings/storage.js' */
/** @import { Tab } from './sites.js' */

/**
 * The chrome APIs reopening uses (`chrome.tabs`, `chrome.windows`, `chrome.storage.session`),
 * as the slices it calls, so tests can pass an in-memory stand-in.
 *
 * @typedef {object} UndoApis
 * @property {{
 *   create(props: chrome.tabs.CreateProperties): Promise<{id?: number}>,
 *   group(options: chrome.tabs.GroupOptions): Promise<number>,
 * }} tabs `chrome.tabs`.
 * @property {{
 *   get(windowId: number): Promise<unknown>,
 *   create(data: chrome.windows.CreateData): Promise<{id?: number, tabs?: {id?: number}[]} | undefined>,
 * }} windows `chrome.windows`.
 * @property {StorageArea} session `chrome.storage.session`.
 */

/**
 * One closed tab, as stored.
 *
 * @typedef {object} ClosedTab
 * @property {string} url Its address.
 * @property {number} windowId The window it was in.
 * @property {number} [index] Its position there.
 * @property {number} groupId Its group, or -1.
 */

/** The chrome.storage.session item holding the batch: `{tabs: ClosedTab[]}`. */
export const CLOSED_KEY = 'lastClosed';
/** The most tabs a batch keeps; appending past it forgets the oldest. */
export const MAX_CLOSED = 500;

/**
 * Remember `tabs` (as returned by chrome.tabs.query) as the latest closed batch, replacing any
 * earlier one, or added to it (automatic closing, so tabs closed by earlier checks can still be
 * reopened). Left out, so they close for good: tabs with no address yet (there'd be nothing to
 * reopen), incognito tabs, and addresses longer than {@link MAX_URL} (a few big `data:` pages
 * would fill session storage, and the write failing would stop the action that closes them).
 *
 * @param {StorageArea} session - `chrome.storage.session`.
 * @param {readonly Tab[]} tabs - The tabs about to close.
 * @param {{append?: boolean}} [options] - `append`: add to the batch instead of replacing it.
 * @returns {Promise<void>}
 */
export async function recordClosed(session, tabs, { append = false } = {}) {
  /** @type {ClosedTab[]} */
  const saved = tabs
    .filter((tab) => !tab.incognito)
    .map((tab) => ({
      url: tabUrl(tab),
      windowId: tab.windowId,
      index: tab.index,
      groupId: tab.groupId ?? -1,
    }))
    .filter((tab) => tab.url && tab.url.length <= MAX_URL);
  /** @type {ClosedTab[]} */
  const earlier = append ? ((await session.get([CLOSED_KEY]))[CLOSED_KEY]?.tabs ?? []) : [];
  await session.set({ [CLOSED_KEY]: { tabs: [...earlier, ...saved].slice(-MAX_CLOSED) } });
}

/**
 * How many tabs the last batch holds.
 *
 * @param {StorageArea} session - `chrome.storage.session`.
 * @returns {Promise<number>} The count, 0 if there's no batch.
 */
export async function closedCount(session) {
  const { [CLOSED_KEY]: batch } = await session.get([CLOSED_KEY]);
  return batch?.tabs?.length ?? 0;
}

/**
 * Whether a window is still open.
 *
 * @param {UndoApis['windows']} windows - `chrome.windows`.
 * @param {number} windowId - The window.
 * @returns {Promise<boolean>} True when `windows.get` finds it.
 */
async function windowExists(windows, windowId) {
  try {
    await windows.get(windowId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reopen the last closed batch and forget it. Tabs go back to their window, position and
 * group where those still exist; tabs whose window has gone reopen together in a new window.
 * A tab Chrome won't open (a file:// page once file access is turned off, say) is left out
 * rather than stopping the rest.
 *
 * @param {UndoApis} apis - `chrome.tabs`, `chrome.windows` and `chrome.storage.session`.
 * @returns {Promise<number[]>} The IDs of the reopened tabs.
 */
export async function reopenClosed({ tabs: tabsApi, windows, session }) {
  const { [CLOSED_KEY]: batch } = await session.get([CLOSED_KEY]);
  if (!batch?.tabs?.length) return [];
  await session.remove(CLOSED_KEY);

  /** @type {number[]} */
  const reopened = [];
  for (const [windowId, saved] of Map.groupBy(/** @type {ClosedTab[]} */ (batch.tabs), (tab) => tab.windowId)) {
    // Ascending order puts each tab back at its old position.
    saved.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const open = await windowExists(windows, windowId);
    /** @type {number | undefined} The new window, once a tab has opened one. */
    let newWindowId;

    for (const tab of saved) {
      try {
        if (!open && newWindowId === undefined) {
          // One address at a time: a list with one address Chrome refuses opens no window at all.
          const created = await windows.create({ url: tab.url });
          newWindowId = created?.id;
          reopened.push(...(created?.tabs ?? []).flatMap((first) => first.id ?? []));
          continue;
        }
        /** @type {chrome.tabs.CreateProperties} */
        const props = { windowId: open ? windowId : newWindowId, url: tab.url, active: false };
        if (open && typeof tab.index === 'number') props.index = tab.index;
        const { id } = await tabsApi.create(props);
        // Chrome always gives a new tab an id; the type allows none.
        if (id === undefined) continue;
        reopened.push(id);
        if (open && tab.groupId !== -1) {
          // The group is gone if all its tabs were closed; the tab just stays ungrouped then.
          await tabsApi.group({ groupId: tab.groupId, tabIds: [id] }).catch(() => {});
        }
      } catch {
        // Some URLs can't be opened by extensions; skip them rather than stop.
      }
    }
  }
  return reopened;
}
