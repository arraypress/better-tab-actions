/**
 * In-memory stand-in for the browser edge: chrome.tabs, chrome.windows, chrome.tabGroups,
 * chrome.extension's file access and chrome.storage (@arraypress/extension-kit's fake storage).
 * Holds real state (window membership, focus, state and bounds, tab order, active, pinned and
 * discarded tabs, groups, saved groups, mute) and refuses what Chromium refuses (addresses
 * extensions can't open, windows mostly off the screen), so tests check outcomes, not calls. Also
 * `runOn`, which runs an action against it as the background does. test/fake-chrome.js adds the
 * events and the rest of `chrome` around it, for the service worker.
 *
 * @module test/fake-browser
 */
import { fakeChromeStorage } from '@arraypress/extension-kit/testing';
import { runAction } from '../extension/shared/actions.js';
import { DEFAULTS } from '../extension/shared/settings.js';

/** @import { Tab } from '../extension/shared/sites.js' */
/** @import { Settings } from '../extension/shared/settings.js' */

/**
 * A tab to start with: its id plus any of Chrome's fields. The rest are an ordinary tab's: window
 * 1, no group, not pinned, active, incognito or muted, and no last-used time.
 *
 * @typedef {Partial<Tab> & {id: number}} TabSeed
 */

/**
 * A tab in the fake: always with an id, as every tab in a window has.
 *
 * @typedef {Tab & {id: number}} FakeTab
 */

/**
 * An open group the extension made.
 *
 * @typedef {{id: number, windowId: number, title: string, color: `${chrome.tabGroups.Color}`, collapsed: boolean}} FakeGroup
 */

/**
 * A window's own state: what `chrome.windows` reports besides its tabs.
 *
 * @typedef {object} FakeWindow
 * @property {`${chrome.windows.WindowState}`} state Normal, maximized, minimized or full screen.
 * @property {`${chrome.windows.WindowType}`} type Normal, popup, app….
 * @property {boolean} focused Whether it's focused.
 * @property {number} [left] Its bounds.
 * @property {number} [top] See `left`.
 * @property {number} [width] See `left`.
 * @property {number} [height] See `left`.
 */

/**
 * One of Chrome's saved groups: `groupId` is null once the group is closed, and `urls` then
 * holds its tabs.
 *
 * @typedef {{title: string, groupId: number | null, urls?: (string | undefined)[]}} SavedGroup
 */

/**
 * The screen the fake's windows open on. Chromium refuses a new window given a position that
 * leaves less than half of it on a screen (`chrome.windows.create` at left 100000 rejects with
 * {@link OFF_SCREEN}), and fits a window given only a size to the screen (9000×5000 opens at the
 * screen's size). Both checked in Chromium 156.
 */
export const SCREEN = Object.freeze({ width: 1920, height: 1080 });
/** Chromium's error for bounds mostly off every screen (windows_api.cc). */
export const OFF_SCREEN = 'Invalid value for bounds. Bounds must be at least 50% within visible screen space.';

/** The id the fake's own extension has. */
export const EXTENSION_ID = 'test-extension-id';

/**
 * The colours Chrome cycles through for new groups.
 *
 * @type {`${chrome.tabGroups.Color}`[]}
 */
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/**
 * A whole tab, as Chrome reports one, from a seed.
 *
 * @param {TabSeed} seed - Its id and whatever differs from an ordinary tab.
 * @returns {FakeTab} The tab (`index` is set when it's reported).
 */
const fakeTab = (seed) => ({
  index: 0, windowId: 1, groupId: -1, pinned: false, highlighted: false, active: false, frozen: false,
  incognito: false, selected: false, discarded: false, autoDiscardable: true, ...seed,
});

/**
 * Seeds for tabs with these addresses, numbered from 1, in window 1.
 *
 * @param {...string} urls - The addresses, in tab order.
 * @returns {TabSeed[]} The seeds.
 * @example
 * fakeBrowser(tabsAt('https://a.com/', 'https://b.com/')); // tabs 1 and 2
 */
export const tabsAt = (...urls) => urls.map((url, i) => ({ id: i + 1, url }));

/**
 * Make the stand-in.
 *
 * @param {TabSeed[]} initialTabs - The open tabs, in order (windows from their `windowId`).
 *   Tabs with `incognito: true` make their window incognito.
 * @param {object} [options] - The window state.
 * @param {number} [options.focusedWindowId] - The window Chrome treats as current when an API
 *   call names none (from a service worker, the last focused window). Default 1.
 * @param {Record<number, Partial<FakeWindow>>} [options.windows] - Windows' own state, by id;
 *   the rest are normal, unfocused windows with no bounds.
 * @param {boolean} [options.fileAccess] - Whether the user lets the extension open file:// pages. Default false.
 * @returns The APIs `runAction` takes, plus getters for what tests check.
 */
export function fakeBrowser(initialTabs, { focusedWindowId = 1, windows: windowSeeds = {}, fileAccess = false } = {}) {
  /** The window Chrome treats as last focused; follows `windows.update({focused})` and new windows. */
  let lastFocused = focusedWindowId;
  let nextTabId = 1000;
  let nextWindowId = 100;
  let nextGroupId = 500;
  // Array order = tab order within each window.
  let tabs = initialTabs.map(fakeTab);
  /**
   * @param {Partial<FakeWindow>} [seed] - What differs from an ordinary window.
   * @returns {FakeWindow} The window.
   */
  const fakeWindow = (seed) => ({ state: 'normal', type: 'normal', focused: false, ...seed });
  /** @type {Map<number, FakeWindow>} Open windows, by id. */
  const openWindows = new Map(tabs.map((t) => [t.windowId, fakeWindow(windowSeeds[t.windowId])]));
  /** @param {number} windowId */
  const incognito = (windowId) => tabs.some((t) => t.windowId === windowId && t.incognito);
  /**
   * @param {number} id - A tab's id.
   * @returns {FakeTab} The live tab, as Chrome holds it.
   * @throws {Error} As Chrome does, when there's no such tab.
   */
  const tabById = (id) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) throw new Error(`No tab with id: ${id}.`);
    return tab;
  };

  /**
   * Why Chromium won't open `url` from an extension, if it won't (extension_tab_util.cc; the
   * first two checked in Chromium 156, where one refused address fails a whole `windows.create`).
   *
   * @param {string | undefined} url - The address asked for.
   * @returns {string | undefined} Chromium's error, or undefined when it opens.
   */
  const refusal = (url) => {
    if (url?.startsWith('javascript:')) return 'JavaScript URLs are not allowed in API based extension navigations.';
    if (url && /^chrome:\/\/(kill|crash|hang|quit|restart)\b/.test(url)) return 'I\'m sorry. I\'m afraid I can\'t do that.';
    if (url?.startsWith('file:') && !fileAccess) return 'Cannot navigate to a file URL without local file access.';
    return undefined;
  };

  /** @type {Map<number, FakeGroup>} Open groups the extension made, by id. */
  const groups = new Map();
  /**
   * Chrome's saved groups, as Chromium 150–157 keeps them (chrome/browser/ui/tabs/saved_tab_groups/):
   * - every new group is saved, whoever made it, except in incognito (no TabGroupSyncService
   *   there) (saved_tab_group_model_listener.cc OnTabGroupAdded);
   * - its title follows the open group's (OnTabGroupChanged, kVisualsChanged);
   * - closing the last tab of a group deletes the saved group (local_tab_group_listener.cc
   *   MaybeRemoveWebContentsFromLocal), but closing its whole window only disconnects it, and it
   *   stays saved (WillCloseAllTabs → TabGroupSyncServiceImpl::RemoveLocalTabGroupMapping).
   *
   * @type {SavedGroup[]}
   */
  const saved = [];
  /** @param {number} groupId */
  const savedFor = (groupId) => saved.find((g) => g.groupId === groupId);
  /** @param {number} groupId */
  const urlsIn = (groupId) => tabs.filter((t) => t.groupId === groupId).map((t) => t.url);

  /** Groups left with no tabs are gone, and so are their saved copies. */
  function dropEmptyGroups() {
    for (const id of [...groups.keys()]) {
      if (tabs.some((t) => t.groupId === id)) continue;
      groups.delete(id);
      const copy = savedFor(id);
      if (copy) saved.splice(saved.indexOf(copy), 1);
    }
  }

  /**
   * Tabs as Chrome reports them, with `index` = position within the window.
   *
   * @returns {FakeTab[]} Copies of every tab.
   */
  const snapshot = () => {
    /** @type {Record<number, number>} */
    const seen = {};
    return tabs.map((t) => ({ ...t, index: (seen[t.windowId] = (seen[t.windowId] ?? -1) + 1) }));
  };

  const tabsApi = {
    /** @param {chrome.tabs.QueryInfo} q - `active`, `windowId`, `lastFocusedWindow` and `windowType` are honoured. */
    async query({ active, windowId, lastFocusedWindow, windowType }) {
      return snapshot().filter((t) =>
        (active === undefined || t.active === active)
        && (windowId === undefined || t.windowId === windowId)
        && (!lastFocusedWindow || t.windowId === lastFocused)
        && (windowType === undefined || openWindows.get(t.windowId)?.type === windowType));
    },
    /** @param {number[]} ids */
    async remove(ids) {
      tabs = tabs.filter((t) => !ids.includes(t.id));
      dropEmptyGroups();
      // Chrome closes a window when its last tab closes.
      for (const id of [...openWindows.keys()]) {
        if (!tabs.some((t) => t.windowId === id)) openWindows.delete(id);
      }
    },
    /** @param {number} id @param {chrome.tabs.UpdateProperties} props */
    async update(id, { muted, pinned, active }) {
      const tab = tabById(id);
      if (muted !== undefined) {
        tab.mutedInfo = muted ? { muted: true, reason: 'extension', extensionId: EXTENSION_ID } : { muted: false };
      }
      if (pinned !== undefined) tab.pinned = pinned;
      // One active tab a window.
      if (active) for (const t of tabs) if (t.windowId === tab.windowId) t.active = t === tab;
      return { ...tab };
    },
    /**
     * Like Chrome, a pinned tab can't go after an unpinned one, nor an unpinned one before a pinned one.
     *
     * @param {chrome.tabs.CreateProperties} props - Where and what.
     */
    async create({ windowId, index, url, pinned = false }) {
      if (windowId === undefined || !openWindows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
      const refused = refusal(url);
      if (refused) throw new Error(refused);
      const tab = fakeTab({ id: nextTabId++, windowId, url, pinned });
      const inWindow = tabs.filter((t) => t.windowId === windowId);
      const pinnedCount = inWindow.filter((t) => t.pinned).length;
      const wanted = typeof index === 'number' ? index : inWindow.length;
      const clamped = pinned ? Math.min(wanted, pinnedCount) : Math.max(wanted, pinnedCount);
      const before = inWindow[clamped];
      const at = before ? tabs.indexOf(before) : tabs.findLastIndex((t) => t.windowId === windowId) + 1;
      tabs.splice(at, 0, tab);
      return { ...tab };
    },
    /** @param {number} id */
    async get(id) {
      const tab = snapshot().find((t) => t.id === id);
      if (!tab) throw new Error(`No tab with id: ${id}.`);
      return tab;
    },
    /**
     * As Chrome 150+ does: the tab keeps its place, address and group but gets a new id. The
     * active tab can't be discarded.
     *
     * @param {number} id - The tab.
     */
    async discard(id) {
      const tab = tabById(id);
      if (tab.active) throw new Error(`Cannot discard tab with id: ${id}.`);
      Object.assign(tab, { id: nextTabId++, discarded: true });
      return { ...tab };
    },
    /**
     * Mirrors Chromium's TabStripModel::GetGroupToAssign: a moved tab's group depends on its new neighbours.
     *
     * @param {number} id - The tab.
     * @param {chrome.tabs.MoveProperties} props - Where to.
     */
    async move(id, { index }) {
      const tab = tabById(id);
      const win = tabs.filter((t) => t.windowId === tab.windowId);
      const from = win.indexOf(tab);
      const to = Math.min(Math.max(index, 0), win.length - 1);
      if (from === to) return { ...tab };

      const NONE = -1;
      /** @param {number} i */
      const groupAt = (i) => win[i]?.groupId ?? NONE;
      const [left, right] = to > from ? [groupAt(to), groupAt(to + 1)] : [groupAt(to - 1), groupAt(to)];
      let group = tab.groupId;
      if (group !== left && group !== right) {
        if (left === right && left !== NONE) group = left; // Dropped inside another group: joins it.
        else if (group !== NONE && win.filter((t) => t.groupId === group).length > 1) group = NONE; // Leaves its group.
      }

      win.splice(from, 1);
      win.splice(to, 0, tab);
      tab.groupId = group;
      let k = 0;
      tabs = tabs.map((t) => (t.windowId === tab.windowId ? win[k++] : t));
      return { ...tab };
    },
    /**
     * Into an existing group, or a new one in `createProperties.windowId` (else the focused
     * window). Like Chrome, tabs from other windows move over, and a new group's tabs are
     * stacked together where its first tab was. Chrome picks the colour.
     *
     * @param {chrome.tabs.GroupOptions} options - The tabs, and the group or window.
     */
    async group({ groupId, tabIds, createProperties }) {
      const chosen = [tabIds].flat().map(tabById);
      if (groupId !== undefined) {
        // Chrome removes a group once it has no tabs left.
        if (!tabs.some((t) => t.groupId === groupId)) throw new Error(`No group with id: ${groupId}.`);
        for (const t of chosen) t.groupId = groupId;
        return groupId;
      }
      const windowId = createProperties?.windowId ?? focusedWindowId;
      if (chosen.some((t) => t.pinned)) throw new Error('Cannot group pinned tabs.');
      if (!openWindows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
      for (const t of chosen) {
        if (t.windowId === windowId) continue;
        tabs.splice(tabs.indexOf(t), 1);
        tabs.push(Object.assign(t, { windowId }));
      }
      const id = nextGroupId++;
      const ordered = tabs.filter((t) => chosen.includes(t));
      const at = tabs.indexOf(ordered[0]);
      const rest = tabs.filter((t) => !chosen.includes(t));
      const before = tabs.slice(0, at).filter((t) => !chosen.includes(t)).length;
      tabs = [...rest.slice(0, before), ...ordered, ...rest.slice(before)];
      for (const t of ordered) t.groupId = id;
      groups.set(id, { id, windowId, title: '', color: GROUP_COLORS[groups.size % GROUP_COLORS.length], collapsed: false });
      if (!incognito(windowId)) saved.push({ title: '', groupId: id });
      dropEmptyGroups(); // Tabs moved out of their old groups.
      return id;
    },
  };

  const tabGroupsApi = {
    /** @param {number} groupId @param {chrome.tabGroups.UpdateProperties} [props] */
    async update(groupId, { title, color, collapsed } = {}) {
      const group = groups.get(groupId);
      if (!group) throw new Error(`No group with id: ${groupId}.`);
      if (title !== undefined) group.title = title;
      if (color !== undefined) group.color = color;
      if (collapsed !== undefined) group.collapsed = collapsed;
      const copy = savedFor(groupId);
      if (copy) copy.title = group.title;
      return { ...group };
    },
    /** @param {number} groupId */
    async get(groupId) {
      const group = groups.get(groupId);
      if (!group) throw new Error(`No group with id: ${groupId}.`);
      return { ...group };
    },
    /** @param {chrome.tabGroups.QueryInfo} info - Only `windowId` is honoured. */
    async query({ windowId }) {
      return [...groups.values()].filter((g) => windowId === undefined || g.windowId === windowId).map((g) => ({ ...g }));
    },
  };

  const windowsApi = {
    /** @param {number} id */
    async get(id) {
      const win = openWindows.get(id);
      if (!win) throw new Error(`No window with id: ${id}.`);
      return { id, ...win, incognito: incognito(id) };
    },
    /** @param {chrome.windows.QueryOptions} options - Which window types, and whether with their tabs. */
    async getAll({ populate, windowTypes } = {}) {
      return [...openWindows]
        .filter(([, win]) => !windowTypes || windowTypes.includes(win.type))
        .map(([id, win]) => ({
          id, ...win, incognito: incognito(id), alwaysOnTop: false,
          tabs: populate ? snapshot().filter((t) => t.windowId === id) : undefined,
        }));
    },
    /**
     * @param {number} id - The window.
     * @param {chrome.windows.UpdateInfo} info - Its new state, or focus.
     */
    async update(id, { state, focused }) {
      const win = openWindows.get(id);
      if (!win) throw new Error(`No window with id: ${id}.`);
      if (state !== undefined) win.state = state;
      if (focused) {
        for (const [other, w] of openWindows) w.focused = other === id;
        lastFocused = id;
      }
      return { id, ...win };
    },
    /**
     * Closes the window and all its tabs at once: its groups stay saved (see `saved`).
     *
     * @param {number} id - The window.
     */
    async remove(id) {
      if (!openWindows.has(id)) throw new Error(`No window with id: ${id}.`);
      for (const [groupId, group] of groups) {
        if (group.windowId !== id) continue;
        const copy = savedFor(groupId);
        if (copy) Object.assign(copy, { urls: urlsIn(groupId), groupId: null });
        groups.delete(groupId);
      }
      tabs = tabs.filter((t) => t.windowId !== id);
      openWindows.delete(id);
    },
    /**
     * Like Chrome: bounds can't be given with a state other than normal, a window placed less
     * than half on the screen is refused, and so is one any of whose addresses can't be opened.
     * Its first tab is active.
     *
     * @param {chrome.windows.CreateData} data - The window.
     */
    async create({ url, state = 'normal', focused = true, left, top, width, height }) {
      const bounds = { left, top, width, height };
      const placed = Object.values(bounds).some((v) => v !== undefined);
      if (state !== 'normal' && placed) throw new Error('Invalid value for state');
      const refused = [url ?? []].flat().map(refusal).find(Boolean);
      if (refused) throw new Error(refused);
      if (left !== undefined || top !== undefined) {
        // A position: at least half the window must be on the screen (Chrome fills in a size not given).
        const box = { left: left ?? 0, top: top ?? 0, width: width ?? 1200, height: height ?? 800 };
        const across = Math.max(0, Math.min(box.left + box.width, SCREEN.width) - Math.max(box.left, 0));
        const down = Math.max(0, Math.min(box.top + box.height, SCREEN.height) - Math.max(box.top, 0));
        if (across * down < (box.width * box.height) / 2) throw new Error(OFF_SCREEN);
      } else {
        // A size alone is never refused: Chrome puts the window on the screen and fits it there.
        if (width !== undefined) bounds.width = Math.min(width, SCREEN.width);
        if (height !== undefined) bounds.height = Math.min(height, SCREEN.height);
      }
      const id = nextWindowId++;
      if (focused) {
        for (const w of openWindows.values()) w.focused = false;
        lastFocused = id;
      }
      openWindows.set(id, fakeWindow({ state, focused, ...Object.fromEntries(Object.entries(bounds).filter(([, v]) => v !== undefined)) }));
      const created = [url ?? 'chrome://newtab/'].flat().map((u, i) => fakeTab({ id: nextTabId++, windowId: id, url: u, active: i === 0 }));
      tabs.push(...created);
      return { id, tabs: created.map((t) => ({ ...t })) };
    },
  };

  const storage = fakeChromeStorage();
  return {
    tabs: tabsApi,
    windows: windowsApi,
    tabGroups: tabGroupsApi,
    session: storage.session,
    local: storage.local,
    extension: { isAllowedFileSchemeAccess: async () => fileAccess },
    /** The whole `chrome.storage` (sync and `onChanged` too), for the service worker. */
    storage,
    /** Turn “Allow access to file URLs” on or off, as on chrome://extensions. */
    setFileAccess(/** @type {boolean} */ allowed) {
      fileAccess = allowed;
    },
    /** The window Chrome treats as last focused. */
    get lastFocusedWindowId() {
      return lastFocused;
    },

    /**
     * A tab as Chrome would pass it to a menu click.
     *
     * @param {number} id - The tab.
     * @returns {FakeTab | undefined} The tab, if open.
     */
    tab: (id) => snapshot().find((t) => t.id === id),
    /** IDs of open tabs, in order. */
    get open() {
      return tabs.map((t) => t.id);
    },
    /** IDs of muted tabs. */
    get muted() {
      return tabs.filter((t) => t.mutedInfo?.muted).map((t) => t.id);
    },
    /** Window ID → URLs in tab order. */
    layout() {
      /** @type {Record<number, (string | undefined)[]>} */
      const out = {};
      for (const t of tabs) (out[t.windowId] ??= []).push(t.url);
      return out;
    },
    /**
     * The group of the tab at `url`.
     *
     * @param {string} url - The tab's address.
     * @returns {number | undefined} Its group id (-1 for none), if open.
     */
    groupOf: (url) => tabs.find((t) => t.url === url)?.groupId,
    /** IDs of open windows. */
    get windowIds() {
      return [...openWindows.keys()];
    },
    /**
     * A window's own state.
     *
     * @param {number} id - The window.
     * @returns {FakeWindow | undefined} A copy, if it's open.
     */
    window: (id) => {
      const win = openWindows.get(id);
      return win && { ...win };
    },
    /** Open groups: { title, color, collapsed, windowId, urls }, in order of creation. */
    get groups() {
      return [...groups.values()].map((g) => ({ title: g.title, color: g.color, collapsed: g.collapsed, windowId: g.windowId, urls: urlsIn(g.id) }));
    },
    /**
     * A window's tabs as "url", with " pinned", " discarded" and " [group title]" when they apply.
     *
     * @param {number} windowId - The window.
     * @returns {string[]} The tabs, in order.
     */
    described: (windowId) => tabs
      .filter((t) => t.windowId === windowId)
      .map((t) => `${t.url}${t.pinned ? ' pinned' : ''}${t.discarded ? ' discarded' : ''}${groups.has(t.groupId ?? -1) ? ` [${groups.get(t.groupId ?? -1)?.title}]` : ''}`),
    /** Chrome's saved groups: { title, urls, open }. */
    get saved() {
      return saved.map((g) => ({ title: g.title, urls: g.groupId === null ? g.urls : urlsIn(g.groupId), open: g.groupId !== null }));
    },
    /** Window ID → "url [g<groupId>]" in tab order, to check order and group membership together. */
    /** @param {number} [windowId] - The window. Default 1. */
    strip(windowId = 1) {
      return tabs
        .filter((t) => t.windowId === windowId)
        .map((t) => (t.groupId === -1 ? t.url : `${t.url} [g${t.groupId}]`));
    },
  };
}

/**
 * Run an action on tab `targetId` (or the active tab when null, as from a shortcut), as the
 * background does: with this fake's extension id.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The fake.
 * @param {string} id - The action.
 * @param {number | null} targetId - The clicked tab, or null for the active one.
 * @param {{now: number, settings?: Settings, locale?: string, workspaceId?: string}} options - The time,
 *   and the settings (default {@link DEFAULTS}), locale and workspace to open.
 * @returns {Promise<number[]>} What `runAction` resolves to.
 */
export const runOn = (b, id, targetId, { now, settings = DEFAULTS, locale, workspaceId }) =>
  runAction(id, targetId === null ? undefined : b.tab(targetId), b, { now, settings, extensionId: EXTENSION_ID, locale, workspaceId });
