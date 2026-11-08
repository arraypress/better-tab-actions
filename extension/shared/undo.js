/**
 * Remembers the last batch of tabs an action closed, so it can be reopened in one go.
 * Stored in chrome.storage.session: survives the service worker sleeping, cleared when Chrome quits.
 *
 * @module shared/undo
 */
import { tabUrl } from './sites.js';

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
 *   create(data: chrome.windows.CreateData): Promise<{tabs?: {id?: number}[]} | undefined>,
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

const KEY = 'lastClosed';

/**
 * Remember `tabs` (as returned by chrome.tabs.query) as the latest closed batch, replacing any
 * earlier one. Tabs with no address yet are left out: there'd be nothing to reopen.
 *
 * @param {StorageArea} session - `chrome.storage.session`.
 * @param {readonly Tab[]} tabs - The tabs about to close.
 * @param {number} now - When, in ms since the epoch.
 * @returns {Promise<void>}
 */
export async function recordClosed(session, tabs, now) {
  /** @type {ClosedTab[]} */
  const saved = tabs
    .map((tab) => ({
      url: tabUrl(tab),
      windowId: tab.windowId,
      index: tab.index,
      groupId: tab.groupId ?? -1,
    }))
    .filter((tab) => tab.url);
  await session.set({ [KEY]: { at: now, tabs: saved } });
}

/**
 * How many tabs the last batch holds.
 *
 * @param {StorageArea} session - `chrome.storage.session`.
 * @returns {Promise<number>} The count, 0 if there's no batch.
 */
export async function closedCount(session) {
  const { [KEY]: batch } = await session.get([KEY]);
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
 *
 * @param {UndoApis} apis - `chrome.tabs`, `chrome.windows` and `chrome.storage.session`.
 * @returns {Promise<number[]>} The IDs of the reopened tabs.
 */
export async function reopenClosed({ tabs: tabsApi, windows, session }) {
  const { [KEY]: batch } = await session.get([KEY]);
  if (!batch?.tabs?.length) return [];
  await session.remove(KEY);

  /** @type {Map<number, ClosedTab[]>} */
  const byWindow = new Map();
  for (const tab of /** @type {ClosedTab[]} */ (batch.tabs)) {
    const list = byWindow.get(tab.windowId) ?? [];
    list.push(tab);
    byWindow.set(tab.windowId, list);
  }

  /** @type {number[]} */
  const reopened = [];
  for (const [windowId, saved] of byWindow) {
    // Ascending order puts each tab back at its old position.
    saved.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    if (await windowExists(windows, windowId)) {
      for (const tab of saved) {
        try {
          /** @type {chrome.tabs.CreateProperties} */
          const props = { windowId, url: tab.url, active: false };
          if (typeof tab.index === 'number') props.index = tab.index;
          const { id } = await tabsApi.create(props);
          // Chrome always gives a new tab an id; the type allows none.
          if (id === undefined) continue;
          reopened.push(id);
          if (tab.groupId !== -1) {
            // The group is gone if all its tabs were closed; the tab just stays ungrouped then.
            await tabsApi.group({ groupId: tab.groupId, tabIds: [id] }).catch(() => {});
          }
        } catch {
          // Some URLs can't be opened by extensions; skip them rather than stop.
        }
      }
    } else {
      try {
        const created = await windows.create({ url: saved.map((tab) => tab.url) });
        reopened.push(...(created?.tabs ?? []).flatMap((tab) => tab.id ?? []));
      } catch {
        // Skip a window that can't be recreated.
      }
    }
  }
  return reopened;
}
