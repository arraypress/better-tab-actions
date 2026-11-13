/**
 * Workspaces: what a snapshot keeps and skips, its size limits and name, the reopen plan, and
 * saving and reopening through `runAction` against the in-memory browser (which keeps window
 * state, pinned and discarded tabs, groups and Chrome's saved groups).
 *
 * @module test/workspaces
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuEntries, menuState, MANAGE_WORKSPACES, WORKSPACE_ITEM_PREFIX } from '../extension/shared/actions.js';
import { DEFAULTS, normalizeSettings } from '../extension/shared/settings.js';
import { MAX_URL } from '../extension/shared/sites.js';
import {
  loadWorkspaces, MAX_BYTES, MAX_TABS, MAX_TITLE, MAX_WORKSPACES, MENU_WORKSPACES, reopenable, reopenPlan,
  replaceWorkspace, snapshotWindows, updateWorkspaces, workspaceName, workspaceSummary,
} from '../extension/shared/workspaces.js';
import { EXTENSION_ID, fakeBrowser, runOn, SCREEN } from './fake-browser.js';
import { errorsLogged, WORDS } from './helpers.js';

/** @import { OpenWindow, Workspace, WorkspaceWindow } from '../extension/shared/workspaces.js' */
/** @import { Settings } from '../extension/shared/settings.js' */
/** @import { TabSeed } from './fake-browser.js' */

const NOW = Date.UTC(2026, 10, 9, 12);

/**
 * Run an action as the background does, in en-GB.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The browser.
 * @param {string} id - The action.
 * @param {number | null} targetId - The clicked tab, or null for the active one.
 * @param {Partial<Settings>} [settings] - Settings that differ from the defaults.
 * @returns {Promise<number[]>} What `runAction` resolves to.
 */
const run = (b, id, targetId, settings = {}) =>
  runOn(b, id, targetId, { now: NOW, locale: 'en-GB', settings: normalizeSettings(settings) });

/**
 * An open window as `chrome.windows.getAll({populate: true})` reports it.
 *
 * @param {number} id - The window.
 * @param {TabSeed[]} tabs - Its tabs, in order (index and window filled in).
 * @param {Partial<OpenWindow>} [extra] - Anything else.
 * @returns {OpenWindow} The window.
 */
const openWindow = (id, tabs, extra = {}) => ({
  id, type: 'normal', incognito: false, state: 'normal', focused: false, ...extra,
  tabs: tabs.map((tab, index) => ({
    index, windowId: id, groupId: -1, pinned: false, highlighted: false, active: false, frozen: false,
    incognito: false, selected: false, discarded: false, autoDiscardable: true, ...tab,
  })),
});

/**
 * A saved window with these addresses and nothing else.
 *
 * @param {...string} urls - Its tabs.
 * @returns {WorkspaceWindow} The window.
 */
const savedWindow = (...urls) => ({ state: 'normal', active: 0, groups: [], tabs: urls.map((url) => ({ url, title: '' })) });

// --- What can be reopened ---

test('reopenable: web, Chrome, extension, data: and view-source: pages; not the ones Chrome refuses', () => {
  for (const url of [
    'https://a.com/', 'http://a.com/x', 'chrome://settings/', 'chrome://newtab/', 'about:blank',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/page.html', 'data:text/html,hi', 'view-source:https://a.com/',
  ]) assert.equal(reopenable(url, false), true, url);
  for (const url of [
    '', 'not a url', 'javascript:void(0)', 'chrome://crash/', 'chrome://kill', 'chrome://quit/', 'chrome://restart/',
    'chrome://hang/', 'devtools://devtools/bundled/inspector.html', 'chrome-untrusted://print/', 'blob:https://a.com/1',
    'chrome-error://chromewebdata/', 'mailto:a@b.com', 'view-source:view-source:https://a.com/', 'view-source:javascript:1',
  ]) assert.equal(reopenable(url, true), false, url);
});

test('reopenable: file:// pages only with file access; over-long addresses never', () => {
  assert.equal(reopenable('file:///Users/me/notes.txt', false), false);
  assert.equal(reopenable('file:///Users/me/notes.txt', true), true);
  assert.equal(reopenable('view-source:file:///Users/me/notes.txt', false), false);
  assert.equal(reopenable(`https://a.com/${'x'.repeat(MAX_URL - 14)}`, false), true);
  assert.equal(reopenable(`https://a.com/${'x'.repeat(MAX_URL - 13)}`, false), false);
});

// --- The snapshot ---

test('snapshotWindows: normal windows only, with tabs in order, pinned, groups, the active tab, state and bounds', () => {
  const { windows, skipped, tabIds } = snapshotWindows([
    openWindow(1, [
      { id: 11, url: 'https://mail.com/', title: 'Mail', pinned: true },
      { id: 12, url: 'https://a.com/1', title: 'A1', groupId: 70 },
      { id: 13, url: 'https://a.com/2', title: 'A2', groupId: 70, active: true },
      { id: 14, url: 'https://b.com/', title: 'B', groupId: 80 },
    ], { state: 'maximized', left: 10, top: 20, width: 1200, height: 800, focused: true }),
    openWindow(2, [{ id: 21, url: 'https://c.com/', title: 'C', active: true }]),
    openWindow(3, [{ id: 31, url: 'https://secret.com/', active: true }], { incognito: true }),
    openWindow(4, [{ id: 41, url: 'https://popup.com/', active: true }], { type: 'popup' }),
  ], [
    { id: 70, title: 'Work', color: 'red', collapsed: false },
    { id: 80, title: '', color: 'blue', collapsed: true },
  ], false);
  assert.equal(skipped, 0, 'incognito and popup windows are left out, not counted as skipped');
  assert.deepEqual(tabIds, [11, 12, 13, 14, 21]);
  assert.deepEqual(windows, [
    {
      state: 'maximized', left: 10, top: 20, width: 1200, height: 800, focused: true, active: 2,
      tabs: [
        { url: 'https://mail.com/', title: 'Mail', pinned: true },
        { url: 'https://a.com/1', title: 'A1', group: 0 },
        { url: 'https://a.com/2', title: 'A2', group: 0 },
        { url: 'https://b.com/', title: 'B', group: 1 },
      ],
      groups: [{ title: 'Work', color: 'red', collapsed: false }, { title: '', color: 'blue', collapsed: true }],
    },
    { state: 'normal', active: 0, tabs: [{ url: 'https://c.com/', title: 'C' }], groups: [] },
  ]);
});

test('snapshotWindows: skips and counts tabs that can’t be reopened; drops their empty groups and windows', () => {
  const { windows, skipped } = snapshotWindows([
    openWindow(1, [
      { id: 1, url: 'https://a.com/' },
      { id: 2, url: 'chrome://crash/', groupId: 5 },
      { id: 3, url: 'javascript:void(0)', active: true },
      { id: 4, url: 'https://b.com/', groupId: 6 },
      { id: 5, url: 'file:///tmp/x.html' },
      { id: 6, url: '', pendingUrl: 'https://loading.com/' },
    ]),
    openWindow(2, [{ id: 7, url: 'devtools://devtools/bundled/inspector.html', active: true }]),
  ], [
    { id: 5, title: 'Gone', color: 'red', collapsed: false },
    { id: 6, title: 'Kept', color: 'green', collapsed: false },
  ], false);
  assert.equal(skipped, 4);
  assert.equal(windows.length, 1, 'a window with nothing to reopen is left out');
  assert.deepEqual(windows[0].tabs.map((tab) => [tab.url, tab.group]), [
    ['https://a.com/', undefined], ['https://b.com/', 0], ['https://loading.com/', undefined],
  ]);
  assert.deepEqual(windows[0].groups, [{ title: 'Kept', color: 'green', collapsed: false }]);
  assert.equal(windows[0].active, 0, 'a skipped active tab passes the part to the tab before it');
});

test('snapshotWindows: at most MAX_TABS tabs and MAX_BYTES; titles cut to MAX_TITLE', () => {
  const many = Array.from({ length: MAX_TABS + 3 }, (_, i) => ({ id: i + 1, url: `https://a.com/${i}`, title: 'x'.repeat(MAX_TITLE + 50) }));
  const counted = snapshotWindows([openWindow(1, many)], [], false);
  assert.equal(counted.windows[0].tabs.length, MAX_TABS);
  assert.equal(counted.skipped, 3);
  assert.equal(counted.windows[0].tabs[0].title.length, MAX_TITLE);

  const long = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, url: `https://a.com/${i}/${'y'.repeat(MAX_URL - 100)}` }));
  const sized = snapshotWindows([openWindow(1, long)], [], false);
  const bytes = new TextEncoder().encode(JSON.stringify(sized.windows)).length;
  assert.ok(sized.skipped > 0 && sized.windows[0].tabs.length + sized.skipped === 100);
  assert.ok(bytes <= MAX_BYTES + 200, `${bytes} bytes`);
});

test('MAX_WORKSPACES full workspaces still fit chrome.storage.local’s 10 MB', () => {
  assert.ok(MAX_WORKSPACES * (MAX_BYTES + 1024) < 10 * 1024 * 1024);
});

// --- Naming ---

test('workspaceName: each window’s main site, at most three; else the date', () => {
  const one = savedWindow('https://github.com/a', 'https://github.com/b', 'https://news.com/');
  assert.equal(workspaceName([one], NOW, 'en-GB'), 'github.com');
  assert.equal(workspaceName([one, savedWindow('https://docs.com/')], NOW, 'en-GB'), 'github.com and docs.com');
  assert.equal(
    workspaceName([one, savedWindow('https://b.com/'), savedWindow('https://c.com/'), savedWindow('https://d.com/')], NOW, 'en-GB'),
    'github.com, b.com and c.com',
  );
  assert.equal(workspaceName([one, savedWindow('https://github.com/c')], NOW, 'en-GB'), 'github.com', 'one name per site');
  assert.equal(workspaceName([savedWindow('https://a.com/', 'https://b.com/')], NOW, 'en-GB'), '9 Nov', 'a tie names it by date');
  assert.equal(workspaceName([savedWindow('chrome://settings/')], NOW, 'en-US'), 'Nov 9');
});

// --- The reopen plan ---

test('reopenPlan: each window opens with its active tab only, at its bounds, then takes its state; groups by tab index', () => {
  /** @type {Workspace} */
  const workspace = {
    id: 'w', name: 'x', savedAt: NOW, skipped: 0,
    windows: [
      {
        state: 'maximized', left: 0, top: 0, width: 900, height: 700, active: 2, groups: [{ title: 'G', color: 'red', collapsed: true }],
        tabs: [{ url: 'https://p.com/', title: '', pinned: true }, { url: 'https://a.com/', title: '', group: 0 }, { url: 'https://b.com/', title: '' }, { url: 'https://c.com/', title: '', group: 0 }],
      },
      { ...savedWindow('https://d.com/'), focused: true },
    ],
  };
  const [first, second] = reopenPlan(workspace, { reopenGroups: true });
  assert.deepEqual(first.create, { url: 'https://b.com/', focused: false, left: 0, top: 0, width: 900, height: 700 });
  assert.equal(first.active, 2);
  assert.deepEqual(first.tabs.map((tab) => tab.pinned), [true, false, false, false]);
  assert.deepEqual(first.groups, [{ title: 'G', color: 'red', collapsed: true, tabs: [1, 3] }]);
  assert.equal(first.state, 'maximized');
  assert.deepEqual([first.focused, second.focused], [false, true], 'the window that was focused is focused last');
  assert.deepEqual(second.create, { url: 'https://d.com/', focused: false });
  assert.deepEqual(reopenPlan(workspace, { reopenGroups: false })[0].groups, [], 'groups left out when not reopened');
});

// --- Saving and reopening, through the actions ---

/**
 * Two windows as in the e2e check: one with a pinned tab and a coloured, collapsed group; plus
 * an incognito window that's never saved.
 *
 * @returns {ReturnType<typeof fakeBrowser>} The browser.
 */
function twoWindows() {
  const b = fakeBrowser([
    { id: 1, url: 'https://mail.com/', pinned: true },
    { id: 2, url: 'https://github.com/a', active: true },
    { id: 3, url: 'https://github.com/b' },
    { id: 4, url: 'https://news.com/' },
    { id: 5, url: 'https://docs.com/', windowId: 2, active: true },
    { id: 6, url: 'https://docs.com/2', windowId: 2 },
    { id: 7, url: 'https://secret.com/', windowId: 3, incognito: true, active: true },
  ], { windows: { 1: { focused: true, left: 5, top: 6, width: 1000, height: 700 }, 2: { state: 'maximized' } } });
  return b;
}

/**
 * Put tabs 3 and 4 into a red, collapsed "Reading" group, as the user would.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The browser from {@link twoWindows}.
 */
async function groupReading(b) {
  const groupId = await b.tabs.group({ tabIds: [3, 4], createProperties: { windowId: 1 } });
  await b.tabGroups.update(groupId, { title: 'Reading', color: 'red', collapsed: true });
}

test('save-workspace: every normal window, not incognito, named after their main sites; listed in the menu', async () => {
  const b = twoWindows();
  await groupReading(b);
  assert.deepEqual((await run(b, 'save-workspace', 2)).sort(), [1, 2, 3, 4, 5, 6]);
  const [saved] = await loadWorkspaces(b.local);
  assert.equal(saved.name, 'github.com and docs.com');
  assert.equal(saved.savedAt, NOW);
  assert.deepEqual(saved.windows.map((win) => win.tabs.length), [4, 2]);

  const state = menuState(await b.tabs.query({}), 0, EXTENSION_ID, 1, await loadWorkspaces(b.local));
  const open = menuEntries(WORDS, DEFAULTS, state).find((entry) => entry.id === 'open-workspace');
  assert.equal(open?.enabled, true);
  assert.deepEqual(open?.children?.map((entry) => entry.title ?? '---'), ['github.com and docs.com', '---', 'Manage workspaces']);
  assert.equal(open?.children?.[0].id, `${WORKSPACE_ITEM_PREFIX}${saved.id}`);
});

test('save-window-workspace: only the clicked tab’s window', async () => {
  const b = twoWindows();
  await run(b, 'save-window-workspace', 6);
  const [saved] = await loadWorkspaces(b.local);
  assert.equal(saved.name, 'docs.com');
  assert.deepEqual(saved.windows.map((win) => win.tabs.map((tab) => tab.url)), [['https://docs.com/', 'https://docs.com/2']]);
  assert.deepEqual(await run(b, 'save-window-workspace', 7), [], 'an incognito window is never saved');
  assert.equal((await loadWorkspaces(b.local)).length, 1);
});

test('open-workspace: new windows with the same tabs, order, pinned tab, group, state and focus; only active tabs load', async () => {
  const b = twoWindows();
  await groupReading(b);
  await run(b, 'save-workspace', 2);
  await b.windows.remove(1);
  await b.windows.remove(2);

  const opened = await run(b, 'open-workspace', null);
  assert.equal(opened.length, 6);
  const [w1, w2] = b.windowIds.filter((id) => id !== 3);
  assert.deepEqual(b.described(w1), [
    'https://mail.com/ pinned discarded',
    'https://github.com/a',
    'https://github.com/b discarded [Reading]',
    'https://news.com/ discarded [Reading]',
  ]);
  assert.deepEqual(b.described(w2), ['https://docs.com/', 'https://docs.com/2 discarded']);
  const reading = b.groups.find((g) => g.title === 'Reading' && g.windowId === w1);
  assert.deepEqual(reading && { color: reading.color, collapsed: reading.collapsed }, { color: 'red', collapsed: true });
  assert.deepEqual(b.window(w1), { state: 'normal', type: 'normal', focused: true, left: 5, top: 6, width: 1000, height: 700 });
  assert.equal(b.window(w2)?.state, 'maximized');
  assert.equal(b.window(w2)?.focused, false);
});

test('open-workspace: a window saved on a screen that’s gone opens where Chrome puts it, at its size (fitted to this screen)', async () => {
  // Chrome refuses a new window less than half on a screen, and with it went the whole workspace.
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', active: true },
    { id: 2, url: 'https://b.com/', windowId: 2, active: true },
    { id: 3, url: 'https://c.com/', windowId: 3, active: true },
  ], {
    windows: {
      1: { left: 100, top: 50, width: 1200, height: 800 }, // On this screen.
      2: { left: SCREEN.width + 640, top: 0, width: 1400, height: 900 }, // On a second display.
      3: { left: -20000, top: -20000, width: 9000, height: 5000 }, // Nowhere, and bigger than this screen twice over.
    },
  });
  await run(b, 'save-workspace', 1);
  for (const id of [1, 2, 3]) await b.windows.remove(id); // The laptop is unplugged from the display.

  assert.equal((await run(b, 'open-workspace', null)).length, 3);
  assert.deepEqual(b.windowIds.map((id) => [b.described(id).join(), b.window(id)]), [
    ['https://a.com/', { state: 'normal', type: 'normal', focused: true, left: 100, top: 50, width: 1200, height: 800 }],
    ['https://b.com/', { state: 'normal', type: 'normal', focused: false, width: 1400, height: 900 }],
    ['https://c.com/', { state: 'normal', type: 'normal', focused: false, width: SCREEN.width, height: SCREEN.height }],
  ]);
});

test('open-workspace: a window Chrome won’t open is left out and logged; the windows after it still open', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'file:///Users/me/notes.html', active: true },
    { id: 2, url: 'https://a.com/', windowId: 2, active: true },
    { id: 3, url: 'file:///Users/me/more.html', windowId: 2 },
  ], { fileAccess: true });
  await run(b, 'save-workspace', 1);
  await b.windows.remove(1);
  await b.windows.remove(2);
  b.setFileAccess(false); // “Allow access to file URLs” turned off since it was saved.

  /** @type {number[]} */
  let opened = [];
  const logged = await errorsLogged(async () => { opened = await run(b, 'open-workspace', null); });
  assert.equal(opened.length, 1);
  assert.deepEqual(Object.values(b.layout()), [['https://a.com/']]);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^Reopening a window: Error: Cannot navigate to a file URL without local file access\./);
});

test('open-workspace: Chrome saves each group it reopens; with “Reopen tab groups” off, tabs come back ungrouped and nothing is added', async () => {
  const b = twoWindows();
  await groupReading(b);
  await run(b, 'save-workspace', 2);
  const savedBefore = b.saved.length;

  await run(b, 'open-workspace', null);
  assert.equal(b.saved.length, savedBefore + 1, 'one more saved “Reading” group');
  await run(b, 'open-workspace', null, { reopenGroups: false });
  assert.equal(b.saved.length, savedBefore + 1, 'none added');
  const last = Math.max(...b.windowIds.filter((id) => b.described(id).includes('https://mail.com/ pinned discarded')));
  assert.ok(b.described(last).every((tab) => !tab.includes('[')));
});

test('open-workspace: by id from the submenu, else the latest; nothing when there are none', async () => {
  const b = twoWindows();
  assert.deepEqual(await run(b, 'open-workspace', null), []);
  await run(b, 'save-window-workspace', 5);
  await runOn(b, 'save-window-workspace', 2, { now: NOW + 1000, locale: 'en-GB' });
  const [latest, older] = await loadWorkspaces(b.local);
  assert.equal(latest.name, 'github.com', 'most recently saved first');

  const before = b.windowIds.length;
  await runOn(b, 'open-workspace', null, { now: NOW, workspaceId: older.id });
  assert.equal(b.windowIds.length, before + 1);
  assert.deepEqual(b.described(Math.max(...b.windowIds)), ['https://docs.com/', 'https://docs.com/2 discarded']);
});

test('save actions: greyed out and do nothing once MAX_WORKSPACES are kept', async () => {
  const b = twoWindows();
  await updateWorkspaces(b.local, () => Array.from({ length: MAX_WORKSPACES }, (_, i) => ({
    id: `w${i}`, name: `w${i}`, savedAt: i, skipped: 0, windows: [savedWindow('https://a.com/')],
  })));
  assert.deepEqual(await run(b, 'save-workspace', 2), []);
  assert.equal((await loadWorkspaces(b.local)).length, MAX_WORKSPACES);

  const entries = menuEntries(WORDS, DEFAULTS, menuState(await b.tabs.query({}), 0, EXTENSION_ID, 1, await loadWorkspaces(b.local)));
  /** @param {string} id */
  const enabled = (id) => entries.find((entry) => entry.id === id)?.enabled;
  assert.deepEqual([enabled('save-workspace'), enabled('save-window-workspace'), enabled('open-workspace')], [false, false, true]);
  const open = entries.find((entry) => entry.id === 'open-workspace');
  assert.equal(open?.children?.length, MENU_WORKSPACES + 2, 'the latest ten, a separator and “Manage workspaces”');
  assert.equal(open?.children?.[0].title, `w${MAX_WORKSPACES - 1}`);
  assert.equal(open?.children?.at(-1)?.id, MANAGE_WORKSPACES);
});

test('menu: “Open workspace” is greyed out with no submenu while nothing is saved; save in incognito is greyed out', async () => {
  const b = twoWindows();
  const entries = menuEntries(WORDS, DEFAULTS, menuState(await b.tabs.query({}), 0, EXTENSION_ID, 3, []));
  const open = entries.find((entry) => entry.id === 'open-workspace');
  assert.deepEqual([open?.enabled, open?.children], [false, undefined]);
  assert.equal(entries.find((entry) => entry.id === 'save-window-workspace')?.enabled, false);
  assert.equal(entries.find((entry) => entry.id === 'save-workspace')?.enabled, true);
});

test('updateWorkspaces: stores the list most recently saved first', async () => {
  const b = fakeBrowser([]);
  /** @param {string} id @param {number} savedAt */
  const ws = (id, savedAt) => ({ id, name: id, savedAt, skipped: 0, windows: [] });
  await updateWorkspaces(b.local, () => [ws('old', 1), ws('new', 3), ws('mid', 2)]);
  assert.deepEqual((await loadWorkspaces(b.local)).map((w) => w.id), ['new', 'mid', 'old']);
  await updateWorkspaces(b.local, (list) => list.filter((w) => w.id !== 'mid'));
  assert.deepEqual((await loadWorkspaces(b.local)).map((w) => w.id), ['new', 'old']);
});

test('workspaceSummary: windows, tabs, the day saved (with the year only for another year), tabs not saved', () => {
  /** @type {Workspace} */
  const workspace = { id: 'w', name: 'x', savedAt: NOW, skipped: 0, windows: [savedWindow('https://a.com/'), savedWindow('https://b.com/', 'https://c.com/')] };
  assert.equal(workspaceSummary(workspace, NOW, WORDS), '2 windows · 3 tabs · Saved 9 Nov');
  assert.equal(
    workspaceSummary({ ...workspace, skipped: 1, windows: [savedWindow('https://a.com/')] }, Date.UTC(2027, 0, 2), WORDS),
    '1 window · 1 tab · Saved 9 Nov 2026 · 1 tab not saved',
  );
});

test('replaceWorkspace: the open windows replace its own, keeping id and name; the settings tab is left out', async () => {
  const b = twoWindows();
  await run(b, 'save-window-workspace', 5);
  const [saved] = await loadWorkspaces(b.local);
  await b.tabs.create({ windowId: 2, url: 'chrome-extension://id/options/options.html' });
  const settingsTab = (await b.tabs.query({})).find((tab) => tab.url?.startsWith('chrome-extension://'));

  const old = await replaceWorkspace(b, saved.id, { now: NOW + 5000, leaveOut: settingsTab?.id });
  assert.deepEqual(old, saved, 'the old version, for “Undo”');
  const [replaced] = await loadWorkspaces(b.local);
  assert.deepEqual([replaced.id, replaced.name, replaced.savedAt], [saved.id, 'docs.com', NOW + 5000]);
  assert.deepEqual(replaced.windows.map((win) => win.tabs.length), [4, 2]);
  assert.equal(await replaceWorkspace(b, 'gone', { now: NOW }), null);
});
