import { siteKey, tabUrl, pageKey } from './sites.js';
import { DEFAULTS } from './settings.js';
import { recordClosed, reopenClosed } from './undo.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Live state some menu labels depend on. The menu is built before anyone right-clicks, so the
 * window counts describe the last focused window, the one a right-click almost always lands in.
 * Running an action looks again at the tab actually clicked.
 */
export const NO_STATE = Object.freeze({
  closedCount: 0,
  mutedByUs: false,
  /** Tabs in the window that are neither pinned nor in a group: what "Save this window as a group" gathers. */
  ungroupedTabs: 0,
  pinnedTabs: 0,
  incognito: false,
});

const inGroup = (tab) => typeof tab.groupId === 'number' && tab.groupId !== -1;

/** Close actions never close pinned tabs, and skip grouped tabs if the setting says so. */
const closable = (tab, settings) => !tab.pinned && (settings.includeGroupedTabs || !inGroup(tab));
const ids = (tabs) => tabs.map((tab) => tab.id);
const close = (tabs) => ({ effect: 'close', ids: ids(tabs) });

/** Whether this extension (not the user) muted the tab. */
const mutedByExtension = (tab, extensionId) =>
  Boolean(tab.mutedInfo?.muted) &&
  tab.mutedInfo.reason === 'extension' &&
  tab.mutedInfo.extensionId === extensionId;

/** The tabs a window's new group gathers: every tab in it that is neither pinned nor already grouped. */
const groupable = (windowId, tabs) =>
  tabs.filter((tab) => tab.windowId === windowId && !tab.pinned && !inGroup(tab));

/** The menu state for the current tabs, the closed batch and the last focused window. */
export function menuState(tabs, closedCount, extensionId, windowId) {
  const inWindow = tabs.filter((tab) => tab.windowId === windowId);
  return {
    closedCount,
    mutedByUs: tabs.some((tab) => mutedByExtension(tab, extensionId)),
    ungroupedTabs: groupable(windowId, tabs).length,
    pinnedTabs: inWindow.filter((tab) => tab.pinned).length,
    incognito: inWindow.some((tab) => tab.incognito),
  };
}

/**
 * A name for a new group: its main site, the one with more of its tabs than any other
 * ("github.com"), else today's date in the user's locale ("8 Nov").
 */
export function groupTitle(tabs, now, locale) {
  const counts = new Map();
  for (const tab of tabs) {
    const key = siteKey(tabUrl(tab));
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1]);
  if (first && (!second || first[1] > second[1])) return first[0];
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(now);
}

/** Put the target window's ungrouped, unpinned tabs into one new, named group. Chrome picks the colour. */
function groupWindow(target, tabs, { now, locale }) {
  const chosen = groupable(target.windowId, tabs);
  return { effect: 'group', ids: ids(chosen), title: groupTitle(chosen, now, locale) };
}

/** The tabs an action may look at: the target's window, or every window if the setting says so. */
const inScope = (target, tabs, settings) =>
  settings.windowScope === 'all' ? tabs : tabs.filter((tab) => tab.windowId === target.windowId);

/** Closable tabs on the same site as `target`. [] if not a web page. */
function sameSite(target, tabs, settings) {
  const key = siteKey(tabUrl(target));
  if (!key) return [];
  return inScope(target, tabs, settings).filter(
    (tab) => closable(tab, settings) && siteKey(tabUrl(tab)) === key,
  );
}

/** For each page open more than once, every copy except one: the target if it's a copy, else a pinned one, else the most recently used. */
function duplicates(target, tabs, settings) {
  const byPage = new Map();
  for (const tab of inScope(target, tabs, settings)) {
    const key = pageKey(tabUrl(tab));
    if (!key) continue;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(tab);
  }
  const result = [];
  for (const copies of byPage.values()) {
    if (copies.length < 2) continue;
    const keep =
      copies.find((tab) => tab.id === target.id) ??
      copies.find((tab) => tab.pinned) ??
      copies.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
    result.push(...copies.filter((tab) => tab !== keep && closable(tab, settings)));
  }
  return result;
}

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

/** Stable sort by site name; non-web pages (chrome://, file://…) go last. */
const bySite = (tabs) =>
  [...tabs].sort((a, b) => {
    const ka = siteKey(tabUrl(a));
    const kb = siteKey(tabUrl(b));
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka.localeCompare(kb);
  });

/**
 * Moves that sort the target's window by site. The window is split into runs of tabs sharing
 * the same group (ungrouped runs included) and each run is sorted on its own, so groups stay
 * intact. Pinned tabs don't move. Moves are applied left to right, each to its final index;
 * every move lands next to a tab from the same run, so Chrome never changes a tab's group.
 */
function sortMoves(target, tabs) {
  const strip = tabs.filter((tab) => tab.windowId === target.windowId).sort((a, b) => a.index - b.index);
  const desired = [];
  let run = [];
  const flush = () => {
    desired.push(...(run[0]?.pinned ? run : bySite(run)));
    run = [];
  };
  for (const tab of strip) {
    const prev = run[0];
    if (prev && (tab.pinned !== prev.pinned || (tab.groupId ?? -1) !== (prev.groupId ?? -1))) flush();
    run.push(tab);
  }
  flush();

  const current = strip.map((tab) => tab.id);
  const moves = [];
  desired.forEach((tab, index) => {
    if (current[index] === tab.id) return;
    current.splice(current.indexOf(tab.id), 1);
    current.splice(index, 0, tab.id);
    moves.push({ id: tab.id, index });
  });
  return moves;
}

/**
 * The actions, in menu order. `section` groups them; a separator goes between sections.
 * `title` is also the shortcut description in manifest.json; `menuTitle(settings, state)` overrides it
 * in the menu, and `enabled(state)` can grey it out (state is NO_STATE's shape).
 * `plan(target, tabs, ctx)` returns { effect: 'close' | 'mute' | 'unmute' | 'move' | 'group', ids, moves?,
 * title?, closeWindow? }.
 * `reopen: true` actions don't plan: they reopen the last closed batch.
 */
export const ACTIONS = [
  {
    id: 'close-site-tabs',
    title: 'Close tabs from this site',
    section: 1,
    plan: (target, tabs, { settings }) => close(sameSite(target, tabs, settings)),
  },
  {
    id: 'close-other-site-tabs',
    title: 'Close other tabs from this site',
    section: 1,
    plan: (target, tabs, { settings }) =>
      close(sameSite(target, tabs, settings).filter((tab) => tab.id !== target.id)),
  },
  {
    id: 'close-duplicate-tabs',
    title: 'Close duplicate tabs',
    section: 1,
    plan: (target, tabs, { settings }) => close(duplicates(target, tabs, settings)),
  },
  {
    // Skips active tabs, playing tabs, and tabs with no last-used time.
    id: 'close-inactive-tabs',
    title: 'Close inactive tabs',
    menuTitle: ({ inactiveDays }) => `Close tabs not used in ${plural(inactiveDays, 'day')}`,
    section: 1,
    plan: (target, tabs, { now, settings }) =>
      close(
        inScope(target, tabs, settings).filter(
          (tab) =>
            closable(tab, settings) &&
            !tab.active &&
            !tab.audible &&
            typeof tab.lastAccessed === 'number' &&
            now - tab.lastAccessed >= settings.inactiveDays * DAY_MS,
        ),
      ),
  },
  {
    // Same window only, like Chrome's own "Close tabs to the right".
    id: 'close-tabs-to-left',
    title: 'Close tabs to the left',
    section: 1,
    plan: (target, tabs, { settings }) =>
      close(
        tabs.filter(
          (tab) =>
            closable(tab, settings) && tab.windowId === target.windowId && tab.index < target.index,
        ),
      ),
  },
  {
    id: 'reopen-closed-tabs',
    title: 'Reopen closed tabs',
    menuTitle: (settings, { closedCount }) =>
      closedCount ? `Reopen ${plural(closedCount, 'closed tab')}` : 'Reopen closed tabs',
    enabled: ({ closedCount }) => closedCount > 0,
    section: 1,
    reopen: true,
  },
  {
    // This window only; tabs keep their groups (see sortMoves).
    id: 'sort-tabs-by-site',
    title: 'Sort tabs by site',
    section: 2,
    plan: (target, tabs) => {
      const moves = sortMoves(target, tabs);
      return { effect: 'move', moves, ids: moves.map((move) => move.id) };
    },
  },
  {
    // Toggles: if any tabs are muted by this extension, unmute them (never touching tabs the
    // user muted); otherwise mute every other tab playing sound, in all windows.
    id: 'mute-other-tabs',
    title: 'Mute or unmute other tabs',
    menuTitle: (settings, { mutedByUs }) => (mutedByUs ? 'Unmute tabs' : 'Mute other tabs'),
    section: 2,
    plan: (target, tabs, { extensionId }) => {
      const ours = tabs.filter((tab) => mutedByExtension(tab, extensionId));
      if (ours.length) return { effect: 'unmute', ids: ids(ours) };
      return {
        effect: 'mute',
        ids: ids(tabs.filter((tab) => tab.audible && !tab.mutedInfo?.muted && tab.id !== target.id)),
      };
    },
  },
  {
    // Chrome saves every tab group it shows, including ones extensions make, so the new group
    // also appears in saved groups. Groups already in the window stay as they are; pinned tabs
    // stay pinned and ungrouped.
    id: 'save-window-as-group',
    title: 'Save this window as a group',
    enabled: ({ ungroupedTabs }) => ungroupedTabs > 0,
    section: 3,
    plan: groupWindow,
  },
  {
    // Groups the window as above, then closes the window: Chrome keeps a saved group whose
    // window closes, so it can be reopened from saved groups later. Not offered when:
    // - the window has pinned tabs, which would close with it and aren't in any group (the user
    //   can unpin them, or move them to another window, first);
    // - it's an incognito window, where Chrome saves no groups.
    // The closed batch for "Reopen closed tabs" is left alone: the saved group is the way back.
    id: 'close-window-keep-group',
    title: 'Close window and keep as group',
    enabled: ({ ungroupedTabs, pinnedTabs, incognito }) => ungroupedTabs > 0 && !pinnedTabs && !incognito,
    section: 3,
    plan: (target, tabs, ctx) => {
      const inWindow = tabs.filter((tab) => tab.windowId === target.windowId);
      if (target.incognito || inWindow.some((tab) => tab.pinned)) return { effect: 'group', ids: [] };
      return { ...groupWindow(target, tabs, ctx), closeWindow: true };
    },
  },
];

const byId = new Map(ACTIONS.map((action) => [action.id, action]));

/** The label an action shows in the menu. */
export function menuTitle(action, settings = DEFAULTS, state = NO_STATE) {
  return action.menuTitle ? action.menuTitle(settings, state) : action.title;
}

/**
 * The submenu contents: visible actions in order as { id, title, enabled }, with a
 * { separator: true } entry between sections that both have visible items.
 */
export function menuEntries(settings = DEFAULTS, state = NO_STATE) {
  const hidden = new Set(settings.hiddenActions);
  const entries = [];
  let section;
  for (const action of ACTIONS) {
    if (hidden.has(action.id)) continue;
    if (section !== undefined && action.section !== section) entries.push({ separator: true });
    section = action.section;
    entries.push({
      id: action.id,
      title: menuTitle(action, settings, state),
      enabled: action.enabled ? action.enabled(state) : true,
    });
  }
  return entries;
}

/**
 * Run action `id` against `target` (or the active tab when no target is given, e.g. from a
 * keyboard shortcut). `browser` is { tabs, windows, session, tabGroups }: chrome.tabs,
 * chrome.windows, chrome.storage.session and chrome.tabGroups. `locale` is for dates in group
 * names (the browser's own when left out). Resolves to the IDs of the tabs closed, muted,
 * unmuted, moved, grouped or reopened.
 */
export async function runAction(
  id,
  target,
  browser,
  { now = Date.now(), settings = DEFAULTS, extensionId, locale } = {},
) {
  const action = byId.get(id);
  if (!action) return [];
  if (action.reopen) return reopenClosed(browser);

  if (!target) {
    [target] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!target) return [];
  }
  const tabs = await browser.tabs.query({});
  const plan = action.plan(target, tabs, { now, settings, extensionId, locale });
  if (!plan.ids.length) return [];

  if (plan.effect === 'close') {
    const chosen = new Set(plan.ids);
    await recordClosed(browser.session, tabs.filter((tab) => chosen.has(tab.id)), now);
    await browser.tabs.remove(plan.ids);
  } else if (plan.effect === 'move') {
    // In order: each move assumes the ones before it have happened.
    for (const { id: tabId, index } of plan.moves) await browser.tabs.move(tabId, { index });
  } else if (plan.effect === 'group') {
    // The window is named: left out, Chrome would use the last focused window, not the clicked one.
    const groupId = await browser.tabs.group({ tabIds: plan.ids, createProperties: { windowId: target.windowId } });
    await browser.tabGroups.update(groupId, { title: plan.title });
    // Closing the window, not its tabs: Chrome deletes a saved group when its last tab is closed,
    // but keeps it when the whole window closes.
    if (plan.closeWindow) await browser.windows.remove(target.windowId);
  } else {
    const muted = plan.effect === 'mute';
    await Promise.all(plan.ids.map((tabId) => browser.tabs.update(tabId, { muted })));
  }
  return plan.ids;
}
