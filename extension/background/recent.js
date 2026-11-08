/**
 * "Switch to last used tab": the tabs most recently brought to the front, across windows.
 *
 * Chrome's own `tab.lastAccessed` only changes when a tab becomes active *in its window*, so
 * flipping between two windows leaves it stale. This list is updated on every tab switch and
 * every window focus change instead, and kept in chrome.storage.session so it survives the
 * service worker sleeping (and is forgotten when the browser closes, like the tabs themselves).
 */

export const RECENT_KEY = 'recentTabs';

/** Enough to step back past a few closed tabs. */
const KEEP = 20;

/** The list with `tabId` moved to the front. */
export function noteUsed(list, tabId) {
  if (typeof tabId !== 'number' || tabId < 0) return list;
  return [tabId, ...list.filter((id) => id !== tabId)].slice(0, KEEP);
}

/** The list without a closed tab. */
export function forget(list, tabId) {
  return list.filter((id) => id !== tabId);
}

/**
 * The tab to switch to: the most recently used one that isn't `currentId` and still exists.
 * With no history yet (just installed, or the browser restarted), the open tab Chrome last
 * activated, by `lastAccessed`.
 */
export function lastUsed(list, currentId, tabs) {
  const live = new Map(tabs.map((tab) => [tab.id, tab]));
  const fromList = list.find((id) => id !== currentId && live.has(id));
  if (fromList !== undefined) return live.get(fromList);
  return tabs
    .filter((tab) => tab.id !== currentId && typeof tab.lastAccessed === 'number')
    .reduce((best, tab) => (!best || tab.lastAccessed > best.lastAccessed ? tab : best), null);
}

/** Read the list from chrome.storage.session. */
export async function loadRecent(session) {
  const { [RECENT_KEY]: list } = await session.get([RECENT_KEY]);
  return Array.isArray(list) ? list.filter((id) => typeof id === 'number') : [];
}
