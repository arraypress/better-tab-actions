/**
 * Workspaces: a named set of windows and their tabs, saved to reopen later. A workspace keeps, per
 * window, its tabs in order (address, title, pinned), its tab groups (title, colour, collapsed,
 * and which tabs are in them), which tab was active, and the window's state and bounds.
 *
 * Workspaces are browsing history, so they live in `chrome.storage.local` only: on this
 * computer, never synced. Sizes are bounded so they always fit local's 10 MB: at most
 * {@link MAX_WORKSPACES} workspaces of at most {@link MAX_TABS} tabs and {@link MAX_BYTES} each.
 *
 * Reopening makes new windows in which only each window's active tab loads: every other tab is
 * discarded as soon as its navigation starts, so it shows its address and loads when clicked
 * (checked in Chromium by test/e2e/workspaces.mjs). Loaded by the service worker and the
 * options page.
 *
 * @module shared/workspaces
 */
import { mainSite, tabUrl } from './sites.js';
import { plural, shortDate } from './text.js';

/** @import { StorageArea } from '../vendor/extension-kit/settings/storage.js' */
/** @import { Tab } from './sites.js' */

/**
 * One saved tab.
 *
 * @typedef {object} WorkspaceTab
 * @property {string} url Its address.
 * @property {string} title Its title when saved (at most {@link MAX_TITLE} characters).
 * @property {true} [pinned] Present when it was pinned.
 * @property {number} [group] Its group: an index into the window's `groups`.
 */

/**
 * One saved tab group.
 *
 * @typedef {object} WorkspaceGroup
 * @property {string} title Its title ('' when it had none).
 * @property {`${chrome.tabGroups.Color}`} color Its colour.
 * @property {boolean} collapsed Whether it was collapsed.
 */

/**
 * One saved window.
 *
 * @typedef {object} WorkspaceWindow
 * @property {`${chrome.windows.WindowState}`} state Normal, maximized, minimized or full screen.
 * @property {number} [left] Its position and size, as Chrome reported them.
 * @property {number} [top] See `left`.
 * @property {number} [width] See `left`.
 * @property {number} [height] See `left`.
 * @property {true} [focused] Present on the window that was focused.
 * @property {number} active The active tab: an index into `tabs`.
 * @property {WorkspaceTab[]} tabs Its tabs, in order (pinned ones first, as Chrome keeps them).
 * @property {WorkspaceGroup[]} groups Its tab groups, in the order they appear.
 */

/**
 * A saved workspace.
 *
 * @typedef {object} Workspace
 * @property {string} id A random id.
 * @property {string} name Its name: made from its main sites, then whatever the user renames it to.
 * @property {number} savedAt When it was saved (or last replaced), in ms since the epoch.
 * @property {number} skipped Tabs that weren't saved: addresses that can't be reopened, or over the size limits.
 * @property {WorkspaceWindow[]} windows Its windows.
 */

/**
 * Windows as `snapshotWindows` makes them: what a workspace keeps, how many tabs it skipped,
 * and the ids of the tabs it kept (not stored).
 *
 * @typedef {{windows: WorkspaceWindow[], skipped: number, tabIds: number[]}} Snapshot
 */

/**
 * A window as `chrome.windows.getAll({populate: true})` reports it, as far as a snapshot reads it.
 *
 * @typedef {Pick<chrome.windows.Window, 'id' | 'type' | 'incognito' | 'state' | 'left' | 'top' | 'width' | 'height' | 'focused'>
 *   & {tabs?: Tab[]}} OpenWindow
 */

/**
 * A group as `chrome.tabGroups.query` reports it, as far as a snapshot reads it.
 *
 * @typedef {Pick<chrome.tabGroups.TabGroup, 'id' | 'title' | 'color' | 'collapsed'>} OpenGroup
 */

/**
 * What reopening one window does, worked out before anything opens.
 *
 * @typedef {object} WindowPlan
 * @property {chrome.windows.CreateData} create The new window, holding the active tab only.
 * @property {number} active The index of the tab the window opens with.
 * @property {{url: string, pinned: boolean}[]} tabs Every tab, in order (the active one included).
 * @property {{tabs: number[], title: string, color: `${chrome.tabGroups.Color}`, collapsed: boolean}[]} groups
 *   The groups to make, each with the indexes of its tabs; none when groups aren't reopened.
 * @property {`${chrome.windows.WindowState}`} state The state to put it in once its tabs are there.
 * @property {boolean} focused Whether it's the window to focus last.
 */

/**
 * The chrome APIs workspaces use, as the slices they call, so tests can pass an in-memory stand-in.
 *
 * @typedef {object} WorkspaceApis
 * @property {{
 *   create(props: chrome.tabs.CreateProperties): Promise<Tab>,
 *   get(tabId: number): Promise<Tab>,
 *   discard(tabId: number): Promise<Tab | undefined>,
 *   group(options: chrome.tabs.GroupOptions): Promise<number>,
 *   update(tabId: number, props: chrome.tabs.UpdateProperties): Promise<unknown>,
 * }} tabs `chrome.tabs`.
 * @property {{
 *   getAll(options: chrome.windows.QueryOptions): Promise<OpenWindow[]>,
 *   get(windowId: number): Promise<Pick<chrome.windows.Window, 'state'>>,
 *   create(data: chrome.windows.CreateData): Promise<{id?: number, tabs?: Tab[]} | undefined>,
 *   update(windowId: number, info: chrome.windows.UpdateInfo): Promise<unknown>,
 * }} windows `chrome.windows`.
 * @property {{
 *   query(info: chrome.tabGroups.QueryInfo): Promise<OpenGroup[]>,
 *   update(groupId: number, props: chrome.tabGroups.UpdateProperties): Promise<unknown>,
 * }} tabGroups `chrome.tabGroups`.
 * @property {{isAllowedFileSchemeAccess(): Promise<boolean>}} extension `chrome.extension`: whether
 *   file:// pages may be opened.
 * @property {StorageArea} local `chrome.storage.local`.
 */

/** The chrome.storage.local item holding the workspaces, most recently saved first. */
export const WORKSPACES_KEY = 'workspaces';
/** The most workspaces kept: saving is turned off until one is deleted. */
export const MAX_WORKSPACES = 40;
/** The most tabs one workspace keeps; the rest are skipped. */
export const MAX_TABS = 500;
/** The most bytes (as stored, JSON) one workspace's tabs take: 40 × 200 KB stays under local's 10 MB. */
export const MAX_BYTES = 200 * 1024;
/** Longer addresses (big data: URLs) are skipped. */
export const MAX_URL = 8192;
/** Titles are cut to this many characters. */
export const MAX_TITLE = 200;
/** The longest name the Rename dialog takes. */
export const MAX_NAME_LENGTH = 253;
/** The most workspaces the "Open workspace" submenu lists. */
export const MENU_WORKSPACES = 10;

/** Schemes `chrome.tabs.create` opens; everything else (javascript:, devtools:, chrome-untrusted:, blob:…) is skipped. */
const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'file:', 'data:', 'about:', 'chrome:', 'chrome-extension:', 'view-source:']);
/** chrome:// pages extensions may not open (Chrome answers "I'm sorry. I'm afraid I can't do that."). */
const BLOCKED_CHROME_PAGES = new Set(['kill', 'crash', 'hang', 'quit', 'restart']);
/** How long to wait for a new tab's navigation to start before giving up on unloading it. */
const NAVIGATION_WAIT_MS = 2000;
/** How long a window state is given to take before it's set again, and how many times. */
const STATE_WAIT_MS = 200;
const STATE_TRIES = 5;

/**
 * @param {number} ms - How long.
 * @returns {Promise<void>} Settles after `ms`.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether an extension can open `url` in a new tab: web pages, Chrome's own pages (not the
 * debug ones that crash or quit), extension pages, data: and view-source: pages, and file://
 * pages when the user allows file access. Checked against Chromium's `chrome.tabs.create`.
 *
 * @param {string} url - A tab's address.
 * @param {boolean} fileAccess - Whether the extension may open file:// pages.
 * @returns {boolean} True when it can be reopened (and isn't too long to keep).
 * @example
 * reopenable('https://a.com/', false); // true
 * reopenable('chrome://crash/', false); // false
 * reopenable('file:///notes.txt', false); // false
 */
export function reopenable(url, fileAccess) {
  if (!url || url.length > MAX_URL) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!OPENABLE_SCHEMES.has(parsed.protocol)) return false;
  if (parsed.protocol === 'view-source:') {
    const inner = url.slice(parsed.protocol.length);
    return !inner.startsWith('view-source:') && reopenable(inner, fileAccess);
  }
  if (parsed.protocol === 'file:') return fileAccess;
  if (parsed.protocol === 'chrome:') return !BLOCKED_CHROME_PAGES.has(parsed.hostname);
  return true;
}

/**
 * @param {unknown} value - Anything.
 * @returns {number} Its JSON's size in bytes, as storage counts it.
 */
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * What a workspace keeps of some open windows: normal windows only (no incognito, popup or app
 * windows), each with its tabs, groups, active tab, state and bounds. Tabs that can't be
 * reopened, or beyond {@link MAX_TABS} or {@link MAX_BYTES}, are skipped and counted; windows left
 * with no tabs are left out.
 *
 * @param {readonly OpenWindow[]} windows - From `chrome.windows.getAll({populate: true})`.
 * @param {readonly OpenGroup[]} groups - From `chrome.tabGroups.query({})`.
 * @param {boolean} fileAccess - Whether file:// pages can be reopened.
 * @param {number} [leaveOut] - A tab to leave out without counting it (the settings page that
 *   asked for the snapshot).
 * @returns {Snapshot} The windows to keep, the number skipped, and the kept tabs' ids.
 */
export function snapshotWindows(windows, groups, fileAccess, leaveOut) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  /** @type {WorkspaceWindow[]} */
  const kept = [];
  /** @type {number[]} */
  const tabIds = [];
  let skipped = 0;
  let count = 0;
  let bytes = 0;

  for (const win of windows) {
    if (win.incognito || (win.type ?? 'normal') !== 'normal') continue;
    /** @type {WorkspaceWindow} */
    const saved = { state: win.state ?? 'normal', active: 0, tabs: [], groups: [] };
    for (const key of /** @type {const} */ (['left', 'top', 'width', 'height'])) {
      if (typeof win[key] === 'number') saved[key] = win[key];
    }
    if (win.focused) saved.focused = true;
    /** @type {Map<number, number>} Chrome's group id → index in `saved.groups`. */
    const groupIndex = new Map();

    for (const tab of (win.tabs ?? []).filter((t) => leaveOut === undefined || t.id !== leaveOut).sort((a, b) => a.index - b.index)) {
      const url = tabUrl(tab);
      /** @type {WorkspaceTab} */
      const entry = { url, title: (tab.title ?? '').slice(0, MAX_TITLE) };
      if (tab.pinned) entry.pinned = true;
      const group = typeof tab.groupId === 'number' ? groupById.get(tab.groupId) : undefined;
      if (group) {
        if (!groupIndex.has(group.id)) {
          groupIndex.set(group.id, saved.groups.length);
          saved.groups.push({ title: group.title ?? '', color: group.color, collapsed: group.collapsed });
        }
        entry.group = groupIndex.get(group.id);
      }
      const size = jsonBytes(entry);
      const keep = reopenable(url, fileAccess) && count < MAX_TABS && bytes + size <= MAX_BYTES;
      // A skipped active tab passes the part to the tab before it.
      if (tab.active) saved.active = keep ? saved.tabs.length : Math.max(0, saved.tabs.length - 1);
      if (!keep) {
        skipped++;
        continue;
      }
      count++;
      bytes += size;
      saved.tabs.push(entry);
      if (tab.id !== undefined) tabIds.push(tab.id);
    }
    if (!saved.tabs.length) continue;
    // Groups whose every tab was skipped go; the rest are renumbered in order.
    const used = [...new Set(saved.tabs.flatMap((tab) => tab.group ?? []))];
    saved.groups = used.map((index) => saved.groups[index]);
    for (const tab of saved.tabs) if (tab.group !== undefined) tab.group = used.indexOf(tab.group);
    kept.push(saved);
  }
  return { windows: kept, skipped, tabIds };
}

/**
 * A name for a workspace, as "Save this window as a group" names a group: each window's main
 * site ("github.com and docs.example" for two windows, at most three sites), else the date.
 *
 * @param {readonly WorkspaceWindow[]} windows - Its windows.
 * @param {number} now - Today, in ms since the epoch.
 * @param {string} [locale] - For the list and the date; the browser's own when left out.
 * @returns {string} The name.
 * @example
 * workspaceName([{ tabs: [{ url: 'https://github.com/' }], … }], now, 'en-GB'); // 'github.com'
 */
export function workspaceName(windows, now, locale) {
  const sites = [...new Set(windows.flatMap((win) => mainSite(win.tabs) ?? []))].slice(0, 3);
  if (!sites.length) return shortDate(now, locale);
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(sites);
}

/**
 * How a workspace's row describes it: windows, tabs, the day it was saved, and any tabs that
 * weren't saved.
 *
 * @param {Workspace} workspace - The workspace.
 * @param {number} now - Today, so the year shows only for another year.
 * @param {string} [locale] - For the date; the browser's own when left out.
 * @returns {string} "2 windows · 24 tabs · Saved 9 Nov", plus " · 3 tabs not saved".
 */
export function workspaceSummary({ windows, skipped, savedAt }, now, locale) {
  const tabs = windows.reduce((sum, win) => sum + win.tabs.length, 0);
  const parts = [plural(windows.length, 'window'), plural(tabs, 'tab'), `Saved ${shortDate(savedAt, locale, now)}`];
  if (skipped) parts.push(`${plural(skipped, 'tab')} not saved`);
  return parts.join(' · ');
}

/**
 * The plan for reopening a workspace: per window, the new window (with the active tab only),
 * the tabs to add around it, the groups to make and the state to end in. The focused window is
 * the one saved as focused, else the first.
 *
 * @param {Workspace} workspace - The workspace.
 * @param {{reopenGroups: boolean}} options - Whether to make its tab groups again.
 * @returns {WindowPlan[]} One plan per window, in order.
 */
export function reopenPlan(workspace, { reopenGroups }) {
  const focusedIndex = Math.max(0, workspace.windows.findIndex((win) => win.focused));
  return workspace.windows.map((win, i) => {
    const active = Math.min(Math.max(0, win.active), win.tabs.length - 1);
    /** @type {chrome.windows.CreateData} */
    const create = { url: win.tabs[active].url, focused: false };
    // Bounds can't be given with another state, so the window opens normal and changes state last.
    for (const key of /** @type {const} */ (['left', 'top', 'width', 'height'])) {
      if (typeof win[key] === 'number') create[key] = win[key];
    }
    return {
      create,
      active,
      tabs: win.tabs.map((tab) => ({ url: tab.url, pinned: Boolean(tab.pinned) })),
      groups: reopenGroups
        ? win.groups.map((group, g) => ({
          ...group,
          tabs: win.tabs.flatMap((tab, t) => (tab.group === g ? [t] : [])),
        }))
        : [],
      state: win.state,
      focused: i === focusedIndex,
    };
  });
}

/**
 * Leave a new tab unloaded: once its navigation has started (it then reports its address),
 * discard it, so it loads only when clicked. Discarded before that, Chrome would forget the
 * address. If the navigation never shows, or Chrome won't discard it, the tab just loads.
 *
 * @param {WorkspaceApis['tabs']} tabs - `chrome.tabs`.
 * @param {Tab} created - The new tab.
 * @returns {Promise<number | undefined>} The tab's id (discarding gives it a new one).
 */
async function leaveUnloaded(tabs, created) {
  if (created.id === undefined) return undefined;
  const id = created.id;
  let tab = created;
  for (const end = Date.now() + NAVIGATION_WAIT_MS; !tab.url && Date.now() < end;) {
    await sleep(10);
    tab = await tabs.get(id);
  }
  if (!tab.url) return id;
  const discarded = await tabs.discard(id).catch(() => undefined);
  return discarded?.id ?? id;
}

/**
 * Put a window in a state. Chromium drops a state set just after tabs are added to a new window
 * (it reads back "normal" a moment later, headed or not), so it's set again until it holds.
 *
 * @param {WorkspaceApis['windows']} windows - `chrome.windows`.
 * @param {number} windowId - The window.
 * @param {`${chrome.windows.WindowState}`} state - Maximized, minimized or full screen.
 * @returns {Promise<void>}
 */
async function setWindowState(windows, windowId, state) {
  for (let tries = 0; tries < STATE_TRIES; tries++) {
    await windows.update(windowId, { state });
    await sleep(STATE_WAIT_MS);
    if ((await windows.get(windowId)).state === state) return;
  }
}

/**
 * Reopen a workspace in new windows, keeping tab order, pinned tabs, groups (when asked) and
 * each window's state. Only each window's active tab loads. A tab Chrome refuses to open is
 * left out rather than stopping the rest.
 *
 * @param {WorkspaceApis} apis - `chrome.tabs`, `chrome.windows` and `chrome.tabGroups`.
 * @param {Workspace} workspace - The workspace.
 * @param {{reopenGroups: boolean}} options - Whether to make its tab groups again (Chrome adds
 *   each group it makes to its saved tab groups).
 * @returns {Promise<number[]>} The ids of the tabs opened.
 */
export async function openWorkspace({ tabs, windows, tabGroups }, workspace, options) {
  /** @type {number[]} */
  const opened = [];
  /** @type {number | undefined} */
  let focusId;
  for (const plan of reopenPlan(workspace, options)) {
    const win = await windows.create(plan.create);
    const windowId = win?.id;
    const first = win?.tabs?.[0]?.id;
    if (windowId === undefined || first === undefined) continue;
    if (plan.tabs[plan.active].pinned) await tabs.update(first, { pinned: true });

    /** @type {Promise<number | undefined>[]} */
    const ids = [];
    for (const [index, { url, pinned }] of plan.tabs.entries()) {
      if (index === plan.active) {
        ids.push(Promise.resolve(first));
        continue;
      }
      // In order: each tab goes at its own index, before the active tab or after the ones made so far.
      const created = await tabs.create({ windowId, url, index, pinned, active: false }).catch(() => undefined);
      ids.push(created ? leaveUnloaded(tabs, created) : Promise.resolve(undefined));
    }
    const tabIds = await Promise.all(ids);
    opened.push(...tabIds.flatMap((id) => id ?? []));

    for (const group of plan.groups) {
      const members = group.tabs.flatMap((index) => tabIds[index] ?? []);
      if (!members.length) continue;
      const groupId = await tabs.group({ tabIds: /** @type {[number, ...number[]]} */ (members), createProperties: { windowId } });
      await tabGroups.update(groupId, { title: group.title, color: group.color, collapsed: group.collapsed });
    }
    if (plan.state !== 'normal') await setWindowState(windows, windowId, plan.state);
    if (plan.focused && plan.state !== 'minimized') focusId = windowId;
  }
  if (focusId !== undefined) await windows.update(focusId, { focused: true });
  return opened;
}

/**
 * The saved workspaces.
 *
 * @param {StorageArea} local - `chrome.storage.local`.
 * @returns {Promise<Workspace[]>} Most recently saved first; [] when there are none.
 */
export async function loadWorkspaces(local) {
  const { [WORKSPACES_KEY]: list } = await local.get([WORKSPACES_KEY]);
  return Array.isArray(list) ? list : [];
}

/**
 * Change the saved workspaces: `change` gets the stored list and returns the new one, which is
 * stored most recently saved first.
 *
 * @param {StorageArea} local - `chrome.storage.local`.
 * @param {(list: Workspace[]) => Workspace[]} change - The change.
 * @returns {Promise<Workspace[]>} The list as stored.
 * @example
 * await updateWorkspaces(chrome.storage.local, (list) => list.filter((w) => w.id !== id)); // delete one
 */
export async function updateWorkspaces(local, change) {
  const list = change(await loadWorkspaces(local)).toSorted((a, b) => b.savedAt - a.savedAt);
  await local.set({ [WORKSPACES_KEY]: list });
  return list;
}

/**
 * Snapshot the open windows (or one of them).
 *
 * @param {WorkspaceApis} apis - `chrome.windows`, `chrome.tabGroups` and `chrome.extension`.
 * @param {{windowId?: number, leaveOut?: number}} [which] - Only window `windowId` (every normal
 *   window when left out), and a tab to leave out.
 * @returns {Promise<Snapshot>} What a workspace would keep.
 */
export async function captureWindows({ windows, tabGroups, extension }, { windowId, leaveOut } = {}) {
  const [all, groups, fileAccess] = await Promise.all([
    windows.getAll({ populate: true, windowTypes: ['normal'] }),
    tabGroups.query({}),
    extension.isAllowedFileSchemeAccess(),
  ]);
  return snapshotWindows(windowId === undefined ? all : all.filter((win) => win.id === windowId), groups, fileAccess, leaveOut);
}

/**
 * Save the open windows (or one of them) as a new workspace, named after their main sites.
 *
 * @param {WorkspaceApis} apis - The chrome APIs.
 * @param {object} options - What to save, and when.
 * @param {number} [options.windowId] - Only this window; every normal window when left out.
 * @param {number} options.now - The time, in ms since the epoch.
 * @param {string} [options.locale] - For the name; the browser's own when left out.
 * @returns {Promise<{workspace: Workspace, tabIds: number[]} | null>} The workspace and the ids
 *   of the tabs it kept; null when there's nothing to save or {@link MAX_WORKSPACES} are kept.
 */
export async function saveWorkspace(apis, { windowId, now, locale }) {
  if ((await loadWorkspaces(apis.local)).length >= MAX_WORKSPACES) return null;
  const { windows, skipped, tabIds } = await captureWindows(apis, { windowId });
  if (!windows.length) return null;
  /** @type {Workspace} */
  const workspace = { id: crypto.randomUUID(), name: workspaceName(windows, now, locale), savedAt: now, skipped, windows };
  await updateWorkspaces(apis.local, (list) => [workspace, ...list]);
  return { workspace, tabIds };
}

/**
 * Replace a workspace's windows with the open ones ("Replace with current windows"), keeping its
 * id and name. It counts as saved now.
 *
 * @param {WorkspaceApis} apis - The chrome APIs.
 * @param {string} id - The workspace.
 * @param {{now: number, leaveOut?: number}} options - The time, and a tab to leave out (the
 *   settings page doing the replacing).
 * @returns {Promise<Workspace | null>} The workspace as it was, for undoing; null when it's gone
 *   or there are no windows to save.
 */
export async function replaceWorkspace(apis, id, { now, leaveOut }) {
  const old = (await loadWorkspaces(apis.local)).find((w) => w.id === id);
  if (!old) return null;
  const { windows, skipped } = await captureWindows(apis, { leaveOut });
  if (!windows.length) return null;
  await updateWorkspaces(apis.local, (list) => list.map((w) => (w.id === id ? { ...w, windows, skipped, savedAt: now } : w)));
  return old;
}
