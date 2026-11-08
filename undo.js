/**
 * Remembers the last batch of tabs an action closed, so it can be reopened in one go.
 * Stored in chrome.storage.session: survives the service worker sleeping, cleared when Chrome quits.
 */
import { tabUrl } from './sites.js';

const KEY = 'lastClosed';

/** Remember `tabs` (as returned by chrome.tabs.query) as the latest closed batch, replacing any earlier one. */
export async function recordClosed(session, tabs, now) {
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

/** How many tabs the last batch holds (0 if none). */
export async function closedCount(session) {
  const { [KEY]: batch } = await session.get([KEY]);
  return batch?.tabs?.length ?? 0;
}

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
 * Resolves to the IDs of the reopened tabs.
 */
export async function reopenClosed({ tabs: tabsApi, windows, session }) {
  const { [KEY]: batch } = await session.get([KEY]);
  if (!batch?.tabs?.length) return [];
  await session.remove(KEY);

  const byWindow = new Map();
  for (const tab of batch.tabs) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }

  const reopened = [];
  for (const [windowId, saved] of byWindow) {
    // Ascending order puts each tab back at its old position.
    saved.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    if (await windowExists(windows, windowId)) {
      for (const tab of saved) {
        try {
          const props = { windowId, url: tab.url, active: false };
          if (typeof tab.index === 'number') props.index = tab.index;
          const created = await tabsApi.create(props);
          reopened.push(created.id);
          if (tab.groupId !== -1) {
            // The group is gone if all its tabs were closed; the tab just stays ungrouped then.
            await tabsApi.group({ groupId: tab.groupId, tabIds: [created.id] }).catch(() => {});
          }
        } catch {
          // Some URLs can't be opened by extensions; skip them rather than stop.
        }
      }
    } else {
      try {
        const created = await windows.create({ url: saved.map((tab) => tab.url) });
        reopened.push(...(created.tabs ?? []).map((tab) => tab.id));
      } catch {
        // Skip a window that can't be recreated.
      }
    }
  }
  return reopened;
}
