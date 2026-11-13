/**
 * "Save this window as a group" and "Close window and keep as group" against the in-memory
 * browser, which keeps Chrome's saved groups as Chromium does; and the group's name.
 *
 * @module test/groups
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuEntries, menuState, groupTitle } from '../extension/shared/actions.js';
import { DEFAULTS } from '../extension/shared/settings.js';
import { closedCount } from '../extension/shared/undo.js';
import { fakeBrowser, runOn, tabsAt, EXTENSION_ID } from './fake-browser.js';
import { entryOf, WORDS } from './helpers.js';

const NOW = Date.UTC(2026, 10, 8, 12);

/**
 * Run an action on tab `targetId` (or the active tab if null), as the background does, in en-GB.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The browser.
 * @param {string} id - The action.
 * @param {number | null} targetId - The clicked tab.
 * @returns {Promise<number[]>} The tabs it acted on.
 */
const run = (b, id, targetId) => runOn(b, id, targetId, { now: NOW, locale: 'en-GB' });

/**
 * The two group items as the menu would show them, for the given window.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The browser.
 * @param {number} windowId - The focused window.
 * @returns {Promise<{save?: boolean, close?: boolean}>} Whether each is enabled.
 */
async function groupItems(b, windowId) {
  const state = menuState(await b.tabs.query({}), await closedCount(b.session), EXTENSION_ID, windowId);
  const entries = menuEntries(WORDS, DEFAULTS, state);
  /** @param {string} id */
  const enabled = (id) => entryOf(entries, id)?.enabled;
  return { save: enabled('save-window-as-group'), close: enabled('close-window-keep-group') };
}

// --- Save this window as a group ---

test('save-window-as-group: one new group of the ungrouped, unpinned tabs, named after the main site', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://mail.com/', pinned: true },
    { id: 2, url: 'https://github.com/a' },
    { id: 3, url: 'https://docs.com/x', groupId: 7 },
    { id: 4, url: 'https://www.github.com/b' },
    { id: 5, url: 'https://news.com/' },
    { id: 6, url: 'chrome://settings/' },
    { id: 7, url: 'https://github.com/other-window', windowId: 2 },
  ]);
  assert.deepEqual(await run(b, 'save-window-as-group', 4), [2, 4, 5, 6]);
  assert.deepEqual(b.groups, [{
    title: 'github.com',
    color: 'grey', // Chrome's pick: the extension doesn't set one.
    collapsed: false,
    windowId: 1,
    urls: ['https://github.com/a', 'https://www.github.com/b', 'https://news.com/', 'chrome://settings/'],
  }]);
  const g = b.groups.length && b.groupOf('https://github.com/a');
  // Stacked together where the first one was; the pinned tab and the old group are untouched.
  assert.deepEqual(b.strip(), [
    'https://mail.com/',
    `https://github.com/a [g${g}]`,
    `https://www.github.com/b [g${g}]`,
    `https://news.com/ [g${g}]`,
    `chrome://settings/ [g${g}]`,
    'https://docs.com/x [g7]',
  ]);
  assert.deepEqual(b.strip(2), ['https://github.com/other-window'], 'other windows are left alone');
  assert.deepEqual(b.saved, [{ title: 'github.com', urls: b.groups[0].urls, open: true }], 'Chrome saves it');
  assert.deepEqual(b.windowIds.sort(), [1, 2], 'nothing closes');
});

test('save-window-as-group: groups the clicked tab’s window, not the focused one', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: 'https://b.com/1', windowId: 2 },
    { id: 3, url: 'https://b.com/2', windowId: 2 },
  ], { focusedWindowId: 1 });
  await run(b, 'save-window-as-group', 2);
  assert.deepEqual(b.groups.map((g) => [g.windowId, g.title, g.urls]), [[2, 'b.com', ['https://b.com/1', 'https://b.com/2']]]);
  assert.deepEqual(b.strip(1), ['https://a.com/']);
});

test('save-window-as-group: from a shortcut, groups the active tab’s window', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/1', active: true },
    { id: 2, url: 'https://a.com/2' },
  ]);
  assert.deepEqual(await run(b, 'save-window-as-group', null), [1, 2]);
  assert.equal(b.groups[0].title, 'a.com');
});

test('groupTitle: the site with the most tabs; a tie or no web pages gives today’s date, in the user’s locale', () => {
  /** @param {...string} urls */
  const tabs = (...urls) => urls.map((url) => ({ url }));
  assert.equal(groupTitle(tabs('https://github.com/', 'https://github.com/x', 'https://a.com/'), NOW, 'en-GB'), 'github.com');
  assert.equal(groupTitle(tabs('https://solo.com/', 'chrome://newtab/'), NOW, 'en-GB'), 'solo.com');
  assert.equal(groupTitle(tabs('https://a.com/', 'https://b.com/'), NOW, 'en-GB'), '8 Nov');
  assert.equal(groupTitle(tabs('chrome://newtab/', 'about:blank'), NOW, 'en-GB'), '8 Nov');
  assert.equal(groupTitle(tabs('https://a.com/', 'https://b.com/'), NOW, 'en-US'), 'Nov 8');
});

test('save-window-as-group: a tie between sites names the group by date', async () => {
  const b = fakeBrowser(tabsAt('https://a.com/', 'https://b.com/'));
  await run(b, 'save-window-as-group', 1);
  assert.equal(b.groups[0].title, '8 Nov');
  assert.equal(b.saved[0].title, '8 Nov');
});

test('save-window-as-group: nothing ungrouped means no group, and the menu item is greyed out', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', pinned: true },
    { id: 2, url: 'https://b.com/', groupId: 7 },
    { id: 3, url: 'https://c.com/', windowId: 2 },
  ]);
  assert.deepEqual(await groupItems(b, 1), { save: false, close: false });
  assert.deepEqual(await run(b, 'save-window-as-group', 2), []);
  assert.deepEqual(b.groups, []);
  assert.deepEqual(b.strip(), ['https://a.com/', 'https://b.com/ [g7]']);
  assert.equal((await groupItems(b, 2)).save, true, 'the other window has something to group');
});

test('menu: the group items follow the window as tabs are grouped', async () => {
  const b = fakeBrowser(tabsAt('https://a.com/', 'https://b.com/'));
  assert.deepEqual(await groupItems(b, 1), { save: true, close: true });
  await run(b, 'save-window-as-group', 1);
  assert.deepEqual(await groupItems(b, 1), { save: false, close: false });
});

// --- Close window and keep as group ---

test('close-window-keep-group: groups the window, closes it, and the group stays saved', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://keep.com/' },
    { id: 2, url: 'https://github.com/a', windowId: 2 },
    { id: 3, url: 'https://github.com/b', windowId: 2 },
    { id: 4, url: 'https://docs.com/', windowId: 2, groupId: 9 },
    { id: 5, url: 'https://news.com/', windowId: 2 },
  ]);
  assert.deepEqual(await run(b, 'close-window-keep-group', 3), [2, 3, 5]);
  assert.deepEqual(b.windowIds, [1], 'the window is closed');
  assert.deepEqual(b.layout(), { 1: ['https://keep.com/'] }, 'other windows are left alone');
  assert.deepEqual(b.saved, [{
    title: 'github.com',
    urls: ['https://github.com/a', 'https://github.com/b', 'https://news.com/'],
    open: false,
  }]);
});

test('close-window-keep-group: leaves "Reopen closed tabs" as it was (the saved group is the way back)', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://old.com/' },
    { id: 2, url: 'https://keep.com/' },
    { id: 3, url: 'https://a.com/', windowId: 2 },
  ]);
  await run(b, 'close-site-tabs', 1);
  await run(b, 'close-window-keep-group', 3);
  assert.equal(await closedCount(b.session), 1);
  await run(b, 'reopen-closed-tabs', null);
  assert.deepEqual(b.layout(), { 1: ['https://old.com/', 'https://keep.com/'] }, 'only the earlier batch comes back');
});

test('close-window-keep-group: not offered, and does nothing, while the window has pinned tabs', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://mail.com/', pinned: true },
    { id: 2, url: 'https://a.com/' },
    { id: 3, url: 'https://b.com/', windowId: 2 },
  ]);
  assert.deepEqual(await groupItems(b, 1), { save: true, close: false });
  assert.deepEqual(await run(b, 'close-window-keep-group', 2), []);
  assert.deepEqual(b.windowIds.sort(), [1, 2], 'nothing closes');
  assert.deepEqual(b.groups, [], 'nothing is grouped either');
  assert.deepEqual(b.strip(), ['https://mail.com/', 'https://a.com/']);
});

test('close-window-keep-group: not offered, and does nothing, in incognito (Chrome saves no groups there)', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', incognito: true },
    { id: 2, url: 'https://a.com/x', incognito: true },
  ]);
  assert.deepEqual(await groupItems(b, 1), { save: true, close: false });
  assert.deepEqual(await run(b, 'close-window-keep-group', 1), []);
  assert.deepEqual(b.windowIds, [1]);
  // Grouping alone still works there; Chrome just doesn't save it.
  await run(b, 'save-window-as-group', 1);
  assert.equal(b.groups[0].title, 'a.com');
  assert.deepEqual(b.saved, []);
});
