/**
 * In-memory stand-in for the browser edge: chrome.tabs, chrome.windows, chrome.tabGroups and
 * chrome.storage.session (@arraypress/extension-kit's fake storage). Holds real state (window
 * membership, tab order, groups, saved groups, mute) so tests check outcomes, not calls. Also
 * `runOn`, which runs an action against it as the background does.
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
 * @typedef {{id: number, windowId: number, title: string, color: string}} FakeGroup
 */

/**
 * One of Chrome's saved groups: `groupId` is null once the group is closed, and `urls` then
 * holds its tabs.
 *
 * @typedef {{title: string, groupId: number | null, urls?: (string | undefined)[]}} SavedGroup
 */

/** The id the fake's own extension has. */
export const EXTENSION_ID = 'test-extension-id';

/** The colours Chrome cycles through for new groups (chrome.tabGroups.Color). */
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
 * @returns The APIs `runAction` takes, plus getters for what tests check.
 */
export function fakeBrowser(initialTabs, { focusedWindowId = 1 } = {}) {
  let nextTabId = 1000;
  let nextWindowId = 100;
  let nextGroupId = 500;
  // Array order = tab order within each window.
  let tabs = initialTabs.map(fakeTab);
  const openWindows = new Set(tabs.map((t) => t.windowId));
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
    /** @param {chrome.tabs.QueryInfo} q */
    async query(q) {
      return q.active ? snapshot().filter((t) => t.active) : snapshot();
    },
    /** @param {number[]} ids */
    async remove(ids) {
      tabs = tabs.filter((t) => !ids.includes(t.id));
      dropEmptyGroups();
      // Chrome closes a window when its last tab closes.
      for (const id of [...openWindows]) {
        if (!tabs.some((t) => t.windowId === id)) openWindows.delete(id);
      }
    },
    /** @param {number} id @param {chrome.tabs.UpdateProperties} props */
    async update(id, { muted }) {
      const tab = tabById(id);
      tab.mutedInfo = muted ? { muted: true, reason: 'extension', extensionId: EXTENSION_ID } : { muted: false };
    },
    /** @param {chrome.tabs.CreateProperties} props */
    async create({ windowId, index, url }) {
      if (windowId === undefined || !openWindows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
      const tab = fakeTab({ id: nextTabId++, windowId, url });
      const inWindow = tabs.filter((t) => t.windowId === windowId);
      const before = typeof index === 'number' ? inWindow[index] : undefined;
      const at = before ? tabs.indexOf(before) : tabs.findLastIndex((t) => t.windowId === windowId) + 1;
      tabs.splice(at, 0, tab);
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
      groups.set(id, { id, windowId, title: '', color: GROUP_COLORS[groups.size % GROUP_COLORS.length] });
      if (!incognito(windowId)) saved.push({ title: '', groupId: id });
      dropEmptyGroups(); // Tabs moved out of their old groups.
      return id;
    },
  };

  const tabGroupsApi = {
    /** @param {number} groupId @param {chrome.tabGroups.UpdateProperties} [props] */
    async update(groupId, { title, color } = {}) {
      const group = groups.get(groupId);
      if (!group) throw new Error(`No group with id: ${groupId}.`);
      if (title !== undefined) group.title = title;
      if (color !== undefined) group.color = color;
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
  };

  const windowsApi = {
    /** @param {number} id */
    async get(id) {
      if (!openWindows.has(id)) throw new Error(`No window with id: ${id}.`);
      return { id, incognito: incognito(id) };
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
    /** @param {chrome.windows.CreateData} data */
    async create({ url }) {
      const id = nextWindowId++;
      openWindows.add(id);
      const created = [url].flat().map((u) => fakeTab({ id: nextTabId++, windowId: id, url: u }));
      tabs.push(...created);
      return { id, tabs: created.map((t) => ({ ...t })) };
    },
  };

  return {
    tabs: tabsApi,
    windows: windowsApi,
    tabGroups: tabGroupsApi,
    session: fakeChromeStorage().session,

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
      return [...openWindows];
    },
    /** Open groups: { title, color, windowId, urls }, in order of creation. */
    get groups() {
      return [...groups.values()].map((g) => ({ title: g.title, color: g.color, windowId: g.windowId, urls: urlsIn(g.id) }));
    },
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
 * @param {{now: number, settings?: Settings, locale?: string}} options - The time, and the settings
 *   (default {@link DEFAULTS}) and locale.
 * @returns {Promise<number[]>} What `runAction` resolves to.
 */
export const runOn = (b, id, targetId, { now, settings = DEFAULTS, locale }) =>
  runAction(id, targetId === null ? undefined : b.tab(targetId), b, { now, settings, extensionId: EXTENSION_ID, locale });
