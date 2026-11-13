/**
 * The service worker's wiring (extension/background/worker.js and menu.js), run for real against
 * an in-memory Chrome (test/fake-chrome.js) that fires Chrome's events: the tab menu built whole
 * and kept in step, menu clicks and shortcuts, the recent tabs across a worker restart, and
 * automatic closing's alarm. test/e2e/ runs the same worker in Chromium.
 *
 * @module test/worker
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { until } from '@arraypress/extension-kit/testing';
import { ACTIONS, MENU_MESSAGE, menuEntries, SWITCH_LAST } from '../extension/shared/actions.js';
import { AUTO_CLOSE_ALARM, AWAKE_KEY, CHECK_MINUTES, HOUR_MS } from '../extension/background/auto-close.js';
import { menuItems, PARENT_ID, REFRESH_MS } from '../extension/background/menu.js';
import { startWorker, WORKSPACES_PAGE } from '../extension/background/worker.js';
import { SNAPSHOT_ALARM } from '../extension/background/auto-snapshot.js';
import { RECENT_KEY } from '../extension/background/recent.js';
import { normalizeSettings } from '../extension/shared/settings.js';
import { loadSnapshots } from '../extension/shared/snapshots.js';
import { closedCount } from '../extension/shared/undo.js';
import { loadWorkspaces } from '../extension/shared/workspaces.js';
import { EXTENSION_ID } from './fake-browser.js';
import { dropListeners, fakeChrome } from './fake-chrome.js';
import { errorsLogged, WORDS } from './helpers.js';

/**
 * A tab as Chrome hands one to a menu click or a shortcut.
 *
 * @param {ReturnType<typeof fakeChrome>} chrome - The stand-in.
 * @param {number} id - The tab.
 * @returns {chrome.tabs.Tab} The tab.
 */
const tabOf = (chrome, id) => /** @type {chrome.tabs.Tab} */ (chrome.browser.tab(id));

/** Long enough for a refresh that was going to happen to have happened. */
const settle = () => new Promise((resolve) => setTimeout(resolve, REFRESH_MS * 3));

/**
 * A Chrome with three tabs on two sites in window 1 (the first active), the worker started on
 * it and its menu built as on install.
 */
async function installed() {
  const chrome = fakeChrome([
    { id: 1, url: 'https://a.com/1', active: true },
    { id: 2, url: 'https://a.com/2' },
    { id: 3, url: 'https://b.com/' },
  ], { windows: { 1: { focused: true } } });
  const handlers = startWorker(chrome.api);
  await chrome.runtime.onInstalled.fire();
  return { chrome, ...handlers };
}

test('menuItems: the submenu first, each parent before its children, separators with ids of their own; nothing when every action is hidden', () => {
  const items = menuItems(menuEntries(WORDS, undefined, {
    closedCount: 2, mutedByUs: false, ungroupedTabs: 1, pinnedTabs: 0, incognito: false, workspaces: [{ id: 'w1', name: 'Work' }],
  }), WORDS.t(MENU_MESSAGE));
  assert.deepEqual(items[0], { id: PARENT_ID, title: 'More tab actions', contexts: ['tab'] });
  assert.ok(items.every((item) => item.contexts?.join() === 'tab'), 'every item is for the tab strip’s menu');
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, 'no id twice');
  for (const [i, item] of items.entries()) {
    if (item.parentId !== undefined) assert.ok(items.findIndex((other) => other.id === item.parentId) < i, `${item.id} comes after its parent`);
  }
  assert.deepEqual(
    items.filter((item) => item.parentId === 'open-workspace').map((item) => item.title ?? item.type),
    ['Work', 'separator', 'Manage workspaces'],
  );
  assert.deepEqual(items.find((item) => item.id === 'reopen-closed-tabs'), {
    id: 'reopen-closed-tabs', parentId: PARENT_ID, title: 'Reopen 2 closed tabs', enabled: true, contexts: ['tab'],
  });
  assert.deepEqual(menuItems([], 'More tab actions'), []);
});

test('install and browser start in one run (a Chrome update): one whole menu, nothing refused', async () => {
  const chrome = fakeChrome([{ id: 1, url: 'https://a.com/', active: true }]);
  startWorker(chrome.api);
  // Both events reach the worker before either build has finished.
  await Promise.all([chrome.runtime.onInstalled.fire(), chrome.runtime.onStartup.fire()]);
  assert.deepEqual(chrome.contextMenus.errors, [], 'no “Cannot create item with duplicate id”');
  assert.deepEqual(
    chrome.contextMenus.items.filter((item) => item.type !== 'separator').map((item) => item.id),
    [PARENT_ID, ...ACTIONS.map((action) => action.id)],
  );
  assert.equal(chrome.contextMenus.shows('reopen-closed-tabs'), 'Reopen closed tabs (greyed out)');
});

test('the menu follows the settings: hidden actions go, every action hidden leaves no menu, the days show in the label', async () => {
  const { chrome } = await installed();
  await chrome.api.storage.sync.set({ hiddenActions: ['sort-tabs-by-site'], inactiveDays: 30 });
  await until(() => chrome.contextMenus.shows('close-inactive-tabs') === 'Close tabs not used in 30 days', 'the rebuilt menu');
  assert.equal(chrome.contextMenus.shows('sort-tabs-by-site'), undefined);
  await chrome.api.storage.sync.set({ hiddenActions: ACTIONS.map((action) => action.id) });
  await until(() => chrome.contextMenus.items.length === 0, 'the menu to go');
});

test('closing tabs from the menu updates only “Reopen closed tabs”; reopening greys it out again', async () => {
  const { chrome, handleMenuClick } = await installed();
  const before = chrome.contextMenus.removals;
  assert.deepEqual(await handleMenuClick({ menuItemId: 'close-other-site-tabs' }, tabOf(chrome, 1)), [2]);
  await until(() => chrome.contextMenus.shows('reopen-closed-tabs') === 'Reopen 1 closed tab', 'the label');
  await settle();
  assert.deepEqual(chrome.contextMenus.updates, [{ id: 'reopen-closed-tabs', title: 'Reopen 1 closed tab', enabled: true }]);
  assert.equal(chrome.contextMenus.removals, before, 'a label change is no rebuild');

  await handleMenuClick({ menuItemId: 'reopen-closed-tabs' }, tabOf(chrome, 1));
  await until(() => chrome.contextMenus.shows('reopen-closed-tabs') === 'Reopen closed tabs (greyed out)', 'the label');
  assert.deepEqual(chrome.browser.layout(), { 1: ['https://a.com/1', 'https://a.com/2', 'https://b.com/'] });
});

test('switching tabs writes the recent list, and neither reads every tab again nor tells Chrome anything about the menu', async () => {
  const { chrome } = await installed();
  // The work a menu refresh starts with: reading every open tab.
  let reads = 0;
  const query = chrome.api.tabs.query;
  chrome.api.tabs.query = /** @type {typeof query} */ ((/** @type {chrome.tabs.QueryInfo} */ info) => {
    reads++;
    return query(info);
  });
  await chrome.tabs.update(2, { active: true });
  await chrome.tabs.update(3, { active: true });
  await until(async () => String((await chrome.api.storage.session.get(RECENT_KEY))[RECENT_KEY]) === '3,2', 'the recent tabs');
  await settle();
  assert.equal(reads, 0, 'a tab switch changes nothing the menu shows');
  assert.deepEqual(chrome.contextMenus.updates, []);
});

test('muting, grouping and window focus keep the labels in step, one update for each change', async () => {
  const chrome = fakeChrome([
    { id: 1, url: 'https://a.com/', active: true },
    { id: 2, url: 'https://music.com/', audible: true },
    { id: 3, url: 'https://b.com/', windowId: 2, active: true, pinned: true },
  ], { windows: { 1: { focused: true } } });
  const { handleMenuClick } = startWorker(chrome.api);
  await chrome.runtime.onInstalled.fire();
  assert.equal(chrome.contextMenus.shows('close-window-keep-group'), 'Close window and keep as group');

  await handleMenuClick({ menuItemId: 'mute-other-tabs' }, tabOf(chrome, 1));
  await until(() => chrome.contextMenus.shows('mute-other-tabs') === 'Unmute tabs', 'the mute label');
  assert.deepEqual(chrome.browser.muted, [2]);

  // Window 2 holds only a pinned tab: nothing to group there.
  await chrome.windows.update(2, { focused: true });
  await until(() => chrome.contextMenus.shows('save-window-as-group') === 'Save this window as a group (greyed out)', 'the group items');
  await settle();
  assert.deepEqual(chrome.contextMenus.updates.map((update) => update.id), ['mute-other-tabs', 'save-window-as-group', 'close-window-keep-group']);
});

test('“Switch to last used tab” goes back and forth, across windows and across a worker restart', async () => {
  const chrome = fakeChrome([
    { id: 1, url: 'https://a.com/', active: true },
    { id: 2, url: 'https://b.com/' },
    { id: 3, url: 'https://c.com/', windowId: 2, active: true },
  ], { windows: { 1: { focused: true } } });
  startWorker(chrome.api);
  await chrome.tabs.update(2, { active: true }); // The person clicks tab 2…
  await chrome.windows.update(2, { focused: true }); // …then window 2, whose tab 3 is in front.

  // Chrome stops the idle worker; the shortcut starts a new one, which has only what was stored.
  dropListeners();
  const { handleCommand } = startWorker(chrome.api);
  assert.deepEqual(await handleCommand(SWITCH_LAST, tabOf(chrome, 3)), [2]);
  assert.equal(chrome.browser.lastFocusedWindowId, 1);
  assert.equal(chrome.browser.tab(2)?.active, true);
  assert.deepEqual(await handleCommand(SWITCH_LAST, tabOf(chrome, 2)), [3], 'pressed again, it comes back');
  assert.equal(chrome.browser.lastFocusedWindowId, 2);
});

test('a shortcut runs its action on the tab Chrome names; an unknown command does nothing', async () => {
  const { chrome } = await installed();
  await chrome.commands.onCommand.fire('close-site-tabs', tabOf(chrome, 1));
  await until(() => chrome.browser.open.join() === '3', 'the site’s tabs to close');
  assert.equal(await closedCount(chrome.api.storage.session), 2);
  await chrome.commands.onCommand.fire('no-such-command', tabOf(chrome, 3));
  assert.deepEqual(chrome.browser.open, [3]);
});

test('workspaces from the menu: saving lists it under “Open workspace”, its item opens it, “Manage workspaces” opens the settings page', async () => {
  const { chrome, handleMenuClick } = await installed();
  assert.equal(chrome.contextMenus.shows('open-workspace'), 'Open workspace (greyed out)');
  await handleMenuClick({ menuItemId: 'save-workspace' }, tabOf(chrome, 1));
  const [workspace] = await loadWorkspaces(chrome.api.storage.local);
  await until(() => chrome.contextMenus.shows(`open-workspace:${workspace.id}`) === workspace.name, 'the submenu item');
  assert.equal(chrome.contextMenus.shows('open-workspace'), 'Open workspace');

  const opened = await handleMenuClick({ menuItemId: `open-workspace:${workspace.id}` }, tabOf(chrome, 1));
  assert.equal(opened.length, 3);
  assert.equal(chrome.browser.windowIds.length, 2);

  assert.deepEqual(await handleMenuClick({ menuItemId: 'manage-workspaces' }, tabOf(chrome, 1)), []);
  assert.ok(Object.values(chrome.browser.layout()).flat().includes(`chrome-extension://${EXTENSION_ID}/${WORKSPACES_PAGE}`));
});

test('a reopened workspace’s slow tab is unloaded when its site answers, even by a worker started since', async () => {
  const chrome = fakeChrome([
    { id: 1, url: 'https://a.com/', active: true },
    { id: 2, url: 'https://slow.com/page' },
    { id: 3, url: 'https://b.com/' },
  ], { windows: { 1: { focused: true } }, slow: ['slow.com'] });
  const { handleCommand } = startWorker(chrome.api);
  await chrome.runtime.onInstalled.fire();
  await handleCommand('save-window-workspace', tabOf(chrome, 1));
  await chrome.windows.remove(1);

  await handleCommand('open-workspace');
  const [win] = chrome.browser.windowIds;
  assert.deepEqual(chrome.browser.described(win), ['https://a.com/', '(waiting for https://slow.com/page)', 'https://b.com/ discarded']);

  // Chrome stops the idle worker; the site answers a minute later, which starts it again.
  dropListeners();
  startWorker(chrome.api);
  await chrome.answer('slow.com');
  await until(() => chrome.browser.described(win)[1].endsWith(' discarded'), 'the slow tab to be unloaded');
  assert.deepEqual(chrome.browser.described(win), ['https://a.com/', 'https://slow.com/page discarded', 'https://b.com/ discarded']);
});

test('an action Chrome refuses is logged with what was clicked, not left as an uncaught rejection', async () => {
  const { chrome } = await installed();
  chrome.api.tabs.remove = async () => { throw new Error('Tabs cannot be edited right now (user may be dragging a tab).'); };
  /** @type {unknown[]} */
  const uncaught = [];
  const note = (/** @type {unknown} */ reason) => { uncaught.push(reason); };
  process.on('unhandledRejection', note);
  const logged = await errorsLogged(async () => {
    await chrome.contextMenus.onClicked.fire({ menuItemId: 'close-site-tabs', editable: false, pageUrl: '' }, tabOf(chrome, 1));
    await chrome.commands.onCommand.fire('close-site-tabs', tabOf(chrome, 1));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  process.off('unhandledRejection', note);
  assert.deepEqual(uncaught, []);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /^The menu item “close-site-tabs”: Error: Tabs cannot be edited right now/);
  assert.match(logged[1], /^The shortcut “close-site-tabs”: Error: Tabs cannot be edited right now/);
});

test('automatic closing: the alarm follows the setting, and each alarm closes the unused tabs into the closed batch', async () => {
  const old = Date.now() - 5 * HOUR_MS;
  const chrome = fakeChrome([
    { id: 1, url: 'https://a.com/', active: true, lastAccessed: old },
    { id: 2, url: 'https://b.com/', lastAccessed: old },
    { id: 3, url: 'https://c.com/', lastAccessed: Date.now() },
  ], { windows: { 1: { focused: true } } });
  startWorker(chrome.api);
  await chrome.runtime.onInstalled.fire();
  assert.equal(chrome.alarms.all.size, 0, 'off by default: no alarm');

  await chrome.api.storage.sync.set(normalizeSettings({ autoClose: true, autoCloseHours: 4 }));
  await until(() => chrome.alarms.all.get(AUTO_CLOSE_ALARM)?.periodInMinutes === CHECK_MINUTES, 'the alarm');
  // Turned on just now: nothing has gone unused for four hours of watching yet.
  await chrome.alarms.onAlarm.fire(/** @type {chrome.alarms.Alarm} */ (chrome.alarms.all.get(AUTO_CLOSE_ALARM)));
  assert.deepEqual(chrome.browser.open, [1, 2, 3]);
  // As if it had been on, with Chrome running, since before the tabs were last used.
  await chrome.api.storage.local.set({ [AWAKE_KEY]: { since: old - HOUR_MS, tick: Date.now(), away: [] } });
  await chrome.alarms.onAlarm.fire(/** @type {chrome.alarms.Alarm} */ (chrome.alarms.all.get(AUTO_CLOSE_ALARM)));
  assert.deepEqual(chrome.browser.open, [1, 3]);
  await until(() => chrome.contextMenus.shows('reopen-closed-tabs') === 'Reopen 1 closed tab', 'the label');

  await chrome.api.storage.sync.set({ autoClose: false });
  await until(() => chrome.alarms.all.size === 0, 'the alarm to be cleared');
  await until(async () => !(AWAKE_KEY in await chrome.api.storage.local.get(AWAKE_KEY)), 'the clock to go');
});

test('automatic snapshots: the alarm follows the setting; one is taken when it’s turned on, then at each alarm only if the windows changed', async () => {
  const { chrome } = await installed();
  const snapshots = () => loadSnapshots(chrome.api.storage.local);
  assert.equal(chrome.alarms.all.size, 0, 'off by default: no alarm');
  assert.deepEqual(await snapshots(), []);

  await chrome.api.storage.sync.set(normalizeSettings({ autoSnapshot: true, snapshotMinutes: 30 }));
  await until(() => chrome.alarms.all.get(SNAPSHOT_ALARM)?.periodInMinutes === 30, 'the alarm');
  await until(async () => (await snapshots()).length === 1, 'the first snapshot');
  const alarm = /** @type {chrome.alarms.Alarm} */ (chrome.alarms.all.get(SNAPSHOT_ALARM));
  await chrome.alarms.onAlarm.fire(alarm);
  assert.equal((await snapshots()).length, 1, 'nothing changed: none taken');
  await chrome.tabs.create({ windowId: 1, url: 'https://new.com/' });
  await chrome.alarms.onAlarm.fire(alarm);
  assert.deepEqual((await snapshots()).map((s) => [s.auto, s.windows[0].tabs.length]), [[true, 4], [true, 3]]);

  // The worker starting again (a browser start) neither resets the alarm nor takes another.
  const creates = chrome.alarms.creates;
  await chrome.runtime.onStartup.fire();
  assert.equal(chrome.alarms.creates, creates);
  assert.equal((await snapshots()).length, 2);

  await chrome.api.storage.sync.set({ autoSnapshot: false });
  await until(() => chrome.alarms.all.size === 0, 'the alarm to be cleared');
  await chrome.tabs.create({ windowId: 1, url: 'https://later.com/' });
  await chrome.alarms.onAlarm.fire(alarm); // A last alarm already on its way does nothing.
  assert.equal((await snapshots()).length, 2, 'the snapshots stay, and no more are taken');
});

test('the toolbar button opens the settings page', async () => {
  const { chrome } = await installed();
  await chrome.action.onClicked.fire();
  assert.deepEqual(chrome.openedOptions, ['options']);
});
