/**
 * The actions in the "More tab actions" submenu: what each one does (as a plan worked out from
 * the tabs), how the menu shows it, and running it against the chrome APIs. Loaded by the
 * service worker and the options page.
 *
 * @module shared/actions
 */
import { mainSite, siteKey, tabUrl, pageKey } from './sites.js';
import { plural, shortDate } from './text.js';
import { DEFAULTS } from './settings.js';
import { recordClosed, reopenClosed } from './undo.js';
import { loadWorkspaces, MAX_WORKSPACES, MENU_WORKSPACES, openWorkspace, saveWorkspace } from './workspaces.js';

/** @import { Tab } from './sites.js' */
/** @import { Settings } from './settings.js' */
/** @import { UndoApis } from './undo.js' */
/** @import { WorkspaceApis } from './workspaces.js' */

/**
 * Live state some menu labels depend on ({@link NO_STATE}'s shape).
 *
 * @typedef {object} MenuState
 * @property {number} closedCount Tabs in the closed batch "Reopen closed tabs" brings back.
 * @property {boolean} mutedByUs Whether any tab is muted by this extension.
 * @property {number} ungroupedTabs Tabs in the window that are neither pinned nor in a group:
 *   what "Save this window as a group" gathers.
 * @property {number} pinnedTabs Pinned tabs in the window.
 * @property {boolean} incognito Whether the window is incognito.
 * @property {{id: string, name: string}[]} workspaces The saved workspaces, most recent first.
 */

/**
 * What a plan needs to know besides the tabs.
 *
 * @typedef {object} PlanContext
 * @property {number} now The time, in ms since the epoch.
 * @property {Settings} settings The user's settings.
 * @property {string} [extensionId] This extension's id, to tell its mutes from the user's.
 * @property {string} [locale] For dates in group names; the browser's own when left out.
 */

/**
 * One tab move: `id` goes to `index` in its window.
 *
 * @typedef {{id: number, index: number}} Move
 */

/**
 * What an action will do, worked out before anything changes.
 *
 * @typedef {{effect: 'close' | 'mute' | 'unmute', ids: number[]}
 *   | {effect: 'move', ids: number[], moves: Move[]}
 *   | {effect: 'group', ids: number[], title: string, closeWindow?: boolean}} Plan
 */

/**
 * A menu action. `title` is also the shortcut description in manifest.json; `menuTitle`
 * overrides it in the menu, `enabled` can grey it out, and `children` makes it a submenu. An
 * action either has a `plan`, or is `reopen: true` and reopens the last closed batch, or has a
 * `workspace` job: save every window, save the clicked one, or open a workspace.
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   section: number,
 *   menuTitle?: (settings: Settings, state: MenuState) => string,
 *   enabled?: (state: MenuState) => boolean,
 *   children?: (state: MenuState) => MenuEntry[],
 * } & (
 *   | {plan: (target: Tab, tabs: Tab[], ctx: PlanContext) => Plan, reopen?: undefined, workspace?: undefined}
 *   | {reopen: true, plan?: undefined, workspace?: undefined}
 *   | {workspace: 'save' | 'save-window' | 'open', plan?: undefined, reopen?: undefined}
 * )} Action
 */

/**
 * An entry in the submenu: an action (perhaps a submenu of its own), or a separator between sections.
 *
 * @typedef {{id: string, title: string, enabled: boolean, children?: MenuEntry[], separator?: undefined}
 *   | {separator: true, id?: undefined, title?: undefined, enabled?: undefined, children?: undefined}} MenuEntry
 */

/** How the "Open workspace" submenu names one workspace's item: this, then the workspace's id. */
export const WORKSPACE_ITEM_PREFIX = 'open-workspace:';
/** The "Open workspace" submenu's last item, to the settings page's Workspaces card. */
export const MANAGE_WORKSPACES = 'manage-workspaces';

/**
 * The chrome APIs {@link runAction} uses, as the slices it calls: `chrome.tabs`,
 * `chrome.windows`, `chrome.storage.session`, `chrome.tabGroups`, and for workspaces
 * `chrome.storage.local` and `chrome.extension`. Tests pass an in-memory stand-in.
 *
 * @typedef {UndoApis & WorkspaceApis & {
 *   tabs: {
 *     query(query: chrome.tabs.QueryInfo): Promise<Tab[]>,
 *     remove(tabIds: number[]): Promise<void>,
 *     move(tabId: number, props: chrome.tabs.MoveProperties): Promise<unknown>,
 *     update(tabId: number, props: chrome.tabs.UpdateProperties): Promise<unknown>,
 *   },
 *   windows: {remove(windowId: number): Promise<void>},
 *   tabGroups: {update(groupId: number, props: chrome.tabGroups.UpdateProperties): Promise<unknown>},
 * }} Browser
 */

/**
 * The real APIs {@link runAction} takes, from the extension's `chrome`.
 *
 * @param {typeof chrome} api - `chrome`.
 * @returns {Browser} Its tabs, windows, tab groups, session and local storage, and file access.
 * @example
 * runAction('sort-tabs-by-site', tab, browserApis(chrome));
 */
export const browserApis = (api) => ({
  tabs: api.tabs,
  windows: api.windows,
  tabGroups: api.tabGroups,
  session: api.storage.session,
  local: api.storage.local,
  extension: api.extension,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The menu state before anything is known: nothing closed, muted or to group. The menu is built
 * before anyone right-clicks, so the window counts describe the last focused window, the one a
 * right-click almost always lands in. Running an action looks again at the tab actually clicked.
 */
export const NO_STATE = /** @type {Readonly<MenuState>} */ (Object.freeze({
  closedCount: 0,
  mutedByUs: false,
  ungroupedTabs: 0,
  pinnedTabs: 0,
  incognito: false,
  workspaces: [],
}));

/**
 * @param {Tab} tab - A tab.
 * @returns {boolean} Whether it's in a tab group.
 */
const inGroup = (tab) => typeof tab.groupId === 'number' && tab.groupId !== -1;

/**
 * Close actions never close pinned tabs, and skip grouped tabs if the setting says so.
 *
 * @param {Tab} tab - A tab.
 * @param {Settings} settings - The user's settings.
 * @returns {boolean} Whether a close action may close it.
 */
const closable = (tab, settings) => !tab.pinned && (settings.includeGroupedTabs || !inGroup(tab));

/**
 * Whether a tab counts as unused for this long, so "Close tabs not used in N days" and automatic
 * closing may close it: a tab a close action may close (see {@link closable}) that isn't the
 * active tab of its window, isn't playing sound, and hasn't been used for `ageMs`. Tabs with no
 * last-used time are left alone.
 *
 * @param {Tab} tab - A tab.
 * @param {Settings} settings - The user's settings (grouped tabs).
 * @param {number} now - The time, in ms since the epoch.
 * @param {number} ageMs - How long unused counts as unused.
 * @returns {boolean} True when it may be closed.
 */
export const unused = (tab, settings, now, ageMs) =>
  closable(tab, settings) &&
  !tab.active &&
  !tab.audible &&
  typeof tab.lastAccessed === 'number' &&
  now - tab.lastAccessed >= ageMs;

/**
 * @param {readonly Tab[]} tabs - Tabs.
 * @returns {number[]} Their IDs. Tabs from `chrome.tabs.query` always have one; the type allows none.
 */
const ids = (tabs) => tabs.flatMap((tab) => tab.id ?? []);

/**
 * @param {readonly Tab[]} tabs - The tabs to close.
 * @returns {Plan} A plan closing them.
 */
const close = (tabs) => ({ effect: 'close', ids: ids(tabs) });

/**
 * Whether this extension (not the user) muted the tab.
 *
 * @param {Tab} tab - A tab.
 * @param {string} [extensionId] - This extension's id.
 * @returns {boolean} True when it's muted, by this extension.
 */
const mutedByExtension = (tab, extensionId) =>
  Boolean(tab.mutedInfo?.muted) &&
  tab.mutedInfo?.reason === 'extension' &&
  tab.mutedInfo.extensionId === extensionId;

/**
 * The tabs a window's new group gathers: every tab in it that is neither pinned nor already grouped.
 *
 * @param {number | undefined} windowId - The window.
 * @param {readonly Tab[]} tabs - Every open tab.
 * @returns {Tab[]} Those tabs, in order.
 */
const groupable = (windowId, tabs) =>
  tabs.filter((tab) => tab.windowId === windowId && !tab.pinned && !inGroup(tab));

/**
 * The menu state for the current tabs, the closed batch and the last focused window.
 *
 * @param {readonly Tab[]} tabs - Every open tab.
 * @param {number} closedCount - Tabs in the closed batch.
 * @param {string} extensionId - This extension's id.
 * @param {number} [windowId] - The last focused window; none when Chrome has no window.
 * @param {readonly {id: string, name: string}[]} [workspaces] - The saved workspaces, most recent first.
 * @returns {MenuState} What the menu's labels and greyed-out items follow.
 */
export function menuState(tabs, closedCount, extensionId, windowId, workspaces = []) {
  const inWindow = tabs.filter((tab) => tab.windowId === windowId);
  return {
    closedCount,
    mutedByUs: tabs.some((tab) => mutedByExtension(tab, extensionId)),
    ungroupedTabs: groupable(windowId, tabs).length,
    pinnedTabs: inWindow.filter((tab) => tab.pinned).length,
    incognito: inWindow.some((tab) => tab.incognito),
    workspaces: workspaces.map(({ id, name }) => ({ id, name })),
  };
}

/**
 * A name for a new group: its main site, the one with more of its tabs than any other
 * ("github.com"), else today's date in the user's locale ("8 Nov"). Exported for its tests.
 *
 * @param {readonly Pick<Tab, 'url' | 'pendingUrl'>[]} tabs - The group's tabs.
 * @param {number} now - Today, in ms since the epoch.
 * @param {string} [locale] - For the date; the browser's own when left out.
 * @returns {string} The group's title.
 * @example
 * groupTitle([{ url: 'https://a.com/' }, { url: 'https://b.com/' }], Date.UTC(2026, 10, 8), 'en-GB'); // '8 Nov'
 */
export function groupTitle(tabs, now, locale) {
  return mainSite(tabs) ?? shortDate(now, locale);
}

/**
 * Put the target window's ungrouped, unpinned tabs into one new, named group. Chrome picks the colour.
 *
 * @param {Tab} target - The clicked tab.
 * @param {readonly Tab[]} tabs - Every open tab.
 * @param {PlanContext} ctx - The time and locale, for the name.
 * @returns {Plan} The group plan.
 */
function groupWindow(target, tabs, { now, locale }) {
  const chosen = groupable(target.windowId, tabs);
  return { effect: 'group', ids: ids(chosen), title: groupTitle(chosen, now, locale) };
}

/**
 * The tabs an action may look at: the target's window, or every window if the setting says so.
 *
 * @param {Tab} target - The clicked tab.
 * @param {readonly Tab[]} tabs - Every open tab.
 * @param {Settings} settings - The user's settings.
 * @returns {readonly Tab[]} The tabs in scope.
 */
const inScope = (target, tabs, settings) =>
  settings.windowScope === 'all' ? tabs : tabs.filter((tab) => tab.windowId === target.windowId);

/**
 * Closable tabs on the same site as `target`.
 *
 * @param {Tab} target - The clicked tab.
 * @param {readonly Tab[]} tabs - Every open tab.
 * @param {Settings} settings - The user's settings.
 * @returns {Tab[]} Those tabs; [] if the target isn't a web page.
 */
function sameSite(target, tabs, settings) {
  const key = siteKey(tabUrl(target));
  if (!key) return [];
  return inScope(target, tabs, settings).filter(
    (tab) => closable(tab, settings) && siteKey(tabUrl(tab)) === key,
  );
}

/**
 * For each page open more than once, every copy except one: the target if it's a copy, else a
 * pinned one, else the most recently used.
 *
 * @param {Tab} target - The clicked tab.
 * @param {readonly Tab[]} tabs - Every open tab.
 * @param {Settings} settings - The user's settings.
 * @returns {Tab[]} The copies to close.
 */
function duplicates(target, tabs, settings) {
  const byPage = Map.groupBy(inScope(target, tabs, settings), (tab) => pageKey(tabUrl(tab)));
  /** @type {Tab[]} */
  const result = [];
  for (const [key, copies] of byPage) {
    if (key === null || copies.length < 2) continue;
    const keep =
      copies.find((tab) => tab.id === target.id) ??
      copies.find((tab) => tab.pinned) ??
      copies.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
    result.push(...copies.filter((tab) => tab !== keep && closable(tab, settings)));
  }
  return result;
}

/**
 * Stable sort by site name; non-web pages (chrome://, file://…) go last.
 *
 * @param {readonly Tab[]} tabs - Tabs.
 * @returns {Tab[]} A sorted copy.
 */
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
 *
 * @param {Tab} target - The clicked tab.
 * @param {readonly Tab[]} tabs - Every open tab.
 * @returns {Move[]} The moves, in the order to make them.
 */
function sortMoves(target, tabs) {
  const strip = tabs.filter((tab) => tab.windowId === target.windowId).sort((a, b) => a.index - b.index);
  /** @type {Tab[]} */
  const desired = [];
  /** @type {Tab[]} */
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
  /** @type {Move[]} */
  const moves = [];
  desired.forEach((tab, index) => {
    if (tab.id === undefined || current[index] === tab.id) return;
    current.splice(current.indexOf(tab.id), 1);
    current.splice(index, 0, tab.id);
    moves.push({ id: tab.id, index });
  });
  return moves;
}

/**
 * The actions, in menu order. `section` groups them; a separator goes between sections.
 *
 * @type {readonly Action[]}
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
      close(inScope(target, tabs, settings).filter((tab) => unused(tab, settings, now, settings.inactiveDays * DAY_MS))),
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
      if (target.incognito || inWindow.some((tab) => tab.pinned)) return { effect: 'group', ids: [], title: '' };
      return { ...groupWindow(target, tabs, ctx), closeWindow: true };
    },
  },
  {
    // Every normal window of this profile (not incognito, popup or app windows). Greyed out once
    // MAX_WORKSPACES are kept.
    id: 'save-workspace',
    title: 'Save windows as workspace',
    enabled: ({ workspaces }) => workspaces.length < MAX_WORKSPACES,
    section: 4,
    workspace: 'save',
  },
  {
    // Not offered in incognito, whose tabs aren't kept.
    id: 'save-window-workspace',
    title: 'Save this window as workspace',
    enabled: ({ workspaces, incognito }) => workspaces.length < MAX_WORKSPACES && !incognito,
    section: 4,
    workspace: 'save-window',
  },
  {
    // In the menu, a submenu of the latest workspaces, then "Manage workspaces". As a keyboard
    // shortcut, it opens the most recently saved one.
    id: 'open-workspace',
    title: 'Open last workspace',
    menuTitle: () => 'Open workspace',
    enabled: ({ workspaces }) => workspaces.length > 0,
    children: ({ workspaces }) => workspaces.length
      ? [
        ...workspaces.slice(0, MENU_WORKSPACES).map(({ id, name }) => ({ id: `${WORKSPACE_ITEM_PREFIX}${id}`, title: name, enabled: true })),
        { separator: true },
        { id: MANAGE_WORKSPACES, title: 'Manage workspaces', enabled: true },
      ]
      : [],
    section: 4,
    workspace: 'open',
  },
];

const actionsById = new Map(ACTIONS.map((action) => [action.id, action]));

/**
 * The label an action shows in the menu.
 *
 * @param {Action} action - One of {@link ACTIONS}.
 * @param {Settings} [settings] - The user's settings. Default {@link DEFAULTS}.
 * @param {MenuState} [state] - The live state. Default {@link NO_STATE}.
 * @returns {string} The label.
 * @example
 * menuTitle(inactiveAction, { ...DEFAULTS, inactiveDays: 1 }); // 'Close tabs not used in 1 day'
 */
export function menuTitle(action, settings = DEFAULTS, state = NO_STATE) {
  return action.menuTitle ? action.menuTitle(settings, state) : action.title;
}

/**
 * The submenu contents: visible actions in order, with a separator between sections that both
 * have visible items.
 *
 * @param {Settings} [settings] - The user's settings. Default {@link DEFAULTS}.
 * @param {MenuState} [state] - The live state. Default {@link NO_STATE}.
 * @returns {MenuEntry[]} The entries; [] when every action is hidden.
 */
export function menuEntries(settings = DEFAULTS, state = NO_STATE) {
  const hidden = new Set(settings.hiddenActions);
  /** @type {MenuEntry[]} */
  const entries = [];
  /** @type {number | undefined} */
  let section;
  for (const action of ACTIONS) {
    if (hidden.has(action.id)) continue;
    if (section !== undefined && action.section !== section) entries.push({ separator: true });
    section = action.section;
    /** @type {MenuEntry} */
    const entry = {
      id: action.id,
      title: menuTitle(action, settings, state),
      enabled: action.enabled ? action.enabled(state) : true,
    };
    const children = action.children?.(state) ?? [];
    if (children.length) entry.children = children;
    entries.push(entry);
  }
  return entries;
}

/**
 * Run action `id` against `target` (or the active tab when no target is given, e.g. from a
 * keyboard shortcut).
 *
 * @param {string} id - The action's id (a menu item or command name).
 * @param {Tab | undefined} target - The clicked tab; the active tab when left out.
 * @param {Browser} browser - chrome.tabs, chrome.windows, chrome.storage.session and chrome.tabGroups.
 * @param {object} [options] - Everything else the plan needs.
 * @param {number} [options.now] - The time. Default `Date.now()`.
 * @param {Settings} [options.settings] - The user's settings. Default {@link DEFAULTS}.
 * @param {string} [options.extensionId] - This extension's id, to tell its mutes from the user's.
 * @param {string} [options.locale] - For dates in group and workspace names; the browser's own when left out.
 * @param {string} [options.workspaceId] - For "open-workspace": the workspace to open. Default the
 *   most recently saved.
 * @returns {Promise<number[]>} The IDs of the tabs closed, muted, unmuted, moved, grouped,
 *   reopened, saved in a workspace or opened from one; [] for an unknown action or nothing to do.
 */
export async function runAction(
  id,
  target,
  browser,
  { now = Date.now(), settings = DEFAULTS, extensionId, locale, workspaceId } = {},
) {
  const action = actionsById.get(id);
  if (!action) return [];
  if (action.reopen) return reopenClosed(browser);
  if (action.workspace === 'open') {
    const list = await loadWorkspaces(browser.local);
    const workspace = workspaceId === undefined ? list[0] : list.find((w) => w.id === workspaceId);
    return workspace ? openWorkspace(browser, workspace, { reopenGroups: settings.reopenGroups }) : [];
  }

  const clicked = target ?? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!clicked) return [];
  if (action.workspace) {
    const windowId = action.workspace === 'save-window' ? clicked.windowId : undefined;
    return (await saveWorkspace(browser, { windowId, now, locale }))?.tabIds ?? [];
  }
  const tabs = await browser.tabs.query({});
  const plan = action.plan(clicked, tabs, { now, settings, extensionId, locale });
  if (!plan.ids.length) return [];

  if (plan.effect === 'close') {
    const chosen = new Set(plan.ids);
    await recordClosed(browser.session, tabs.filter((tab) => tab.id !== undefined && chosen.has(tab.id)), now);
    await browser.tabs.remove(plan.ids);
  } else if (plan.effect === 'move') {
    // In order: each move assumes the ones before it have happened.
    for (const { id: tabId, index } of plan.moves) await browser.tabs.move(tabId, { index });
  } else if (plan.effect === 'group') {
    // Not empty: checked above. Chrome's type asks for at least one id.
    const tabIds = /** @type {[number, ...number[]]} */ (plan.ids);
    // The window is named: left out, Chrome would use the last focused window, not the clicked one.
    const groupId = await browser.tabs.group({ tabIds, createProperties: { windowId: clicked.windowId } });
    await browser.tabGroups.update(groupId, { title: plan.title });
    // Closing the window, not its tabs: Chrome deletes a saved group when its last tab is closed,
    // but keeps it when the whole window closes.
    if (plan.closeWindow) await browser.windows.remove(clicked.windowId);
  } else {
    const muted = plan.effect === 'mute';
    await Promise.all(plan.ids.map((tabId) => browser.tabs.update(tabId, { muted })));
  }
  return plan.ids;
}
