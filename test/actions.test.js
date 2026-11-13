/**
 * The menu actions against the in-memory browser: what each closes, mutes, moves or reopens,
 * the menu's labels and order, and the manifest's commands. The group actions are in
 * groups.test.js.
 *
 * @module test/actions
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, NO_STATE, SWITCH_LAST, SWITCH_LAST_MESSAGE, menuEntries, menuState, menuTitle } from '../extension/shared/actions.js';
import { DEFAULTS, normalizeSettings } from '../extension/shared/settings.js';
import { closedCount } from '../extension/shared/undo.js';
import { fakeBrowser, runOn, tabsAt, EXTENSION_ID } from './fake-browser.js';
import { WORDS } from './helpers.js';

/** @import { Action } from '../extension/shared/actions.js' */
/** @import { Settings } from '../extension/shared/settings.js' */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 8);
const ALL_WINDOWS = normalizeSettings({ windowScope: 'all' });

/**
 * Run an action on tab `targetId` (or the active tab if null) with the given settings.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The browser.
 * @param {string} id - The action.
 * @param {number | null} targetId - The clicked tab.
 * @param {Settings} [settings] - Default {@link DEFAULTS}.
 * @returns {Promise<number[]>} The tabs it acted on.
 */
const run = (b, id, targetId, settings = DEFAULTS) => runOn(b, id, targetId, { now: NOW, settings });

/**
 * @param {string} id - An action's id.
 * @returns {Action} That action.
 */
const action = (id) => {
  const found = ACTIONS.find((a) => a.id === id);
  assert.ok(found, id);
  return found;
};

// --- Close tabs from this site ---

test('close-site-tabs: by default, closes the site in this window only', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: 'https://www.b.com/x' },
    { id: 3, url: 'https://b.com/y', windowId: 2 },
    { id: 4, url: 'https://b.com/pinned', pinned: true },
    { id: 5, url: 'https://docs.b.com/' },
    { id: 6, url: '', pendingUrl: 'https://b.com/loading' },
  ]);
  assert.deepEqual(await run(b, 'close-site-tabs', 2), [2, 6]);
  assert.deepEqual(b.open, [1, 3, 4, 5]);
});

test('close-site-tabs: with "All windows", closes the site everywhere', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://b.com/x' },
    { id: 2, url: 'https://b.com/y', windowId: 2 },
    { id: 3, url: 'https://a.com/', windowId: 2 },
  ]);
  assert.deepEqual(await run(b, 'close-site-tabs', 1, ALL_WINDOWS), [1, 2]);
  assert.deepEqual(b.open, [3]);
});

test('close-site-tabs: does nothing for a non-web tab', async () => {
  const b = fakeBrowser([{ id: 1, url: 'chrome://newtab/' }, { id: 2, url: 'chrome://newtab/' }]);
  assert.deepEqual(await run(b, 'close-site-tabs', 1), []);
  assert.deepEqual(b.open, [1, 2]);
});

test('close-site-tabs: with no target (shortcut) uses the active tab', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', active: true },
    { id: 2, url: 'https://a.com/z' },
    { id: 3, url: 'https://b.com/y' },
  ]);
  assert.deepEqual(await run(b, 'close-site-tabs', null), [1, 2]);
  assert.deepEqual(b.open, [3]);
});

test('close actions include grouped tabs by default, and skip them when the setting is off', async () => {
  const tabs = [
    { id: 1, url: 'https://a.com/1' },
    { id: 2, url: 'https://a.com/2', groupId: 7 },
    { id: 3, url: 'https://a.com/3' },
  ];
  assert.deepEqual(await run(fakeBrowser(tabs), 'close-site-tabs', 1), [1, 2, 3]);

  const b = fakeBrowser(tabs);
  assert.deepEqual(await run(b, 'close-site-tabs', 1, normalizeSettings({ includeGroupedTabs: false })), [1, 3]);
  assert.deepEqual(b.open, [2]);
});

// --- Close other tabs from this site ---

test('close-other-site-tabs: keeps the clicked tab', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/1' },
    { id: 2, url: 'https://a.com/2' },
    { id: 3, url: 'https://b.com/' },
  ]);
  assert.deepEqual(await run(b, 'close-other-site-tabs', 2), [1]);
  assert.deepEqual(b.open, [2, 3]);
});

// --- Close duplicate tabs ---

test('close-duplicate-tabs: keeps the clicked copy, else the most recent; ignores #fragments', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/p', lastAccessed: NOW },
    { id: 2, url: 'https://a.com/p#section' },
    { id: 3, url: 'https://a.com/p?x=1' },
    { id: 4, url: 'https://b.com/', lastAccessed: NOW - 2 * DAY },
    { id: 5, url: 'https://b.com/', lastAccessed: NOW - 1 * DAY },
  ]);
  // a.com/p: keep clicked tab 2. b.com: keep most recently used tab 5.
  assert.deepEqual(await run(b, 'close-duplicate-tabs', 2), [1, 4]);
  assert.deepEqual(b.open, [2, 3, 5]);
});

test('close-duplicate-tabs: by default ignores copies in other windows; "All windows" includes them', async () => {
  const tabs = [
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: 'https://a.com/', windowId: 2 },
  ];
  assert.deepEqual(await run(fakeBrowser(tabs), 'close-duplicate-tabs', 1), []);
  assert.deepEqual(await run(fakeBrowser(tabs), 'close-duplicate-tabs', 1, ALL_WINDOWS), [2]);
});

test('close-duplicate-tabs: prefers keeping a pinned copy and never closes pinned', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', lastAccessed: NOW },
    { id: 2, url: 'https://a.com/', pinned: true, lastAccessed: NOW - DAY },
    { id: 9, url: 'https://z.com/' },
  ]);
  assert.deepEqual(await run(b, 'close-duplicate-tabs', 9), [1]);
  assert.deepEqual(b.open, [2, 9]);
});

// --- Close inactive tabs ---

test('close-inactive-tabs: closes tabs unused for the set days, sparing active/pinned/audible/unknown', async () => {
  const old = NOW - DEFAULTS.inactiveDays * DAY;
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', lastAccessed: old },
    { id: 2, url: 'https://b.com/', lastAccessed: old + 1 },
    { id: 3, url: 'https://c.com/', lastAccessed: old, active: true },
    { id: 4, url: 'https://d.com/', lastAccessed: old, pinned: true },
    { id: 5, url: 'https://e.com/', lastAccessed: old, audible: true },
    { id: 6, url: 'https://f.com/' },
    { id: 7, url: 'https://g.com/', lastAccessed: old, windowId: 2 },
  ]);
  assert.deepEqual(await run(b, 'close-inactive-tabs', 3), [1]);
  assert.deepEqual(b.open, [2, 3, 4, 5, 6, 7]);
});

test('close-inactive-tabs: honours a custom number of days', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', lastAccessed: NOW - 2 * DAY },
    { id: 2, url: 'https://b.com/', lastAccessed: NOW - 1 * DAY },
    { id: 3, url: 'https://c.com/', active: true },
  ]);
  assert.deepEqual(await run(b, 'close-inactive-tabs', 3, normalizeSettings({ inactiveDays: 2 })), [1]);
});

// --- Close tabs to the left ---

test('close-tabs-to-left: closes earlier tabs in the same window, keeps pinned and other windows', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://pinned.com/', pinned: true },
    { id: 2, url: 'https://a.com/' },
    { id: 3, url: 'chrome://settings/' },
    { id: 4, url: 'https://b.com/' },
    { id: 5, url: 'https://c.com/' },
    { id: 6, url: 'https://d.com/', windowId: 2 },
  ]);
  assert.deepEqual(await run(b, 'close-tabs-to-left', 4, ALL_WINDOWS), [2, 3]);
  assert.deepEqual(b.open, [1, 4, 5, 6]);
});

test('close-tabs-to-left: first tab closes nothing', async () => {
  const b = fakeBrowser(tabsAt('https://a.com/', 'https://b.com/'));
  assert.deepEqual(await run(b, 'close-tabs-to-left', 1), []);
  assert.deepEqual(b.open, [1, 2]);
});

// --- Reopen closed tabs ---

test('reopen-closed-tabs: brings back the last batch in its original positions and group', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://keep.com/1' },
    { id: 2, url: 'https://a.com/1' },
    { id: 3, url: 'https://keep.com/2', groupId: 5 },
    { id: 4, url: 'https://a.com/2', groupId: 5 },
    { id: 5, url: 'https://keep.com/3' },
  ]);
  const before = b.layout();
  await run(b, 'close-site-tabs', 2);
  assert.equal(await closedCount(b.session), 2);

  const reopened = await run(b, 'reopen-closed-tabs', null);
  assert.equal(reopened.length, 2);
  assert.deepEqual(b.layout(), before, 'same tabs, same order');
  assert.equal(b.groupOf('https://a.com/2'), 5, 'back in its group');
  assert.equal(await closedCount(b.session), 0, 'batch is used up');
  assert.deepEqual(await run(b, 'reopen-closed-tabs', null), [], 'second reopen does nothing');
});

test('reopen-closed-tabs: tabs whose window closed come back together in a new window', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://keep.com/' },
    { id: 2, url: 'https://a.com/1', windowId: 2 },
    { id: 3, url: 'https://a.com/2', windowId: 2 },
  ]);
  await run(b, 'close-site-tabs', 2); // Closes window 2 entirely.
  assert.deepEqual(Object.keys(b.layout()), ['1']);

  await run(b, 'reopen-closed-tabs', null);
  const windows = Object.values(b.layout());
  assert.deepEqual(windows, [['https://keep.com/'], ['https://a.com/1', 'https://a.com/2']]);
});

test('reopen-closed-tabs: a tab Chrome won’t open again is left out of a new window, not the whole window lost', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://keep.com/', active: true },
    { id: 2, url: 'file:///Users/me/notes.html', windowId: 2 },
    { id: 3, url: 'https://a.com/1', windowId: 2 },
    { id: 4, url: 'https://a.com/2', windowId: 2 },
    { id: 5, url: 'https://front.com/', windowId: 2, active: true },
  ], { fileAccess: true });
  await run(b, 'close-tabs-to-left', 5);
  await b.windows.remove(2); // The person closes what's left of the window…
  b.setFileAccess(false); // …and has turned “Allow access to file URLs” off since.

  assert.equal((await run(b, 'reopen-closed-tabs', null)).length, 2);
  assert.deepEqual(Object.values(b.layout()), [['https://keep.com/'], ['https://a.com/1', 'https://a.com/2']]);
});

test('closing incognito tabs keeps none of their addresses: they don’t come back, least of all in an ordinary window', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/1', active: true },
    { id: 2, url: 'https://a.com/2' },
    { id: 3, url: 'https://a.com/secret', windowId: 2, incognito: true },
    { id: 4, url: 'https://b.com/', windowId: 2, incognito: true, active: true },
  ]);
  assert.deepEqual(await run(b, 'close-other-site-tabs', 1, ALL_WINDOWS), [2, 3], 'both close');
  assert.equal(await closedCount(b.session), 1, 'only the ordinary window’s tab is remembered');
  assert.doesNotMatch(JSON.stringify(b.session.data), /secret/);

  await b.windows.remove(2); // The incognito window is closed: nothing of it should be left.
  await run(b, 'reopen-closed-tabs', null);
  assert.deepEqual(b.layout(), { 1: ['https://a.com/1', 'https://a.com/2'] });
});

test('a tab with a huge data: address still closes with the rest; it just can’t be reopened', async () => {
  // Session storage holds 10 MB: before, writing the batch failed and the action closed nothing.
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: `data:text/html,${'x'.repeat(11 * 1024 * 1024)}` },
    { id: 3, url: 'https://front.com/', active: true },
  ]);
  assert.deepEqual(await run(b, 'close-tabs-to-left', 3), [1, 2]);
  assert.deepEqual(b.open, [3]);
  assert.equal(await closedCount(b.session), 1);
  await run(b, 'reopen-closed-tabs', null);
  assert.deepEqual(b.layout()[1], ['https://a.com/', 'https://front.com/']);
});

test('reopen-closed-tabs: only the most recent batch is kept', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: 'https://b.com/' },
    { id: 3, url: 'https://c.com/' },
  ]);
  await run(b, 'close-site-tabs', 1);
  await run(b, 'close-site-tabs', 2);
  await run(b, 'reopen-closed-tabs', null);
  assert.deepEqual(b.layout()[1], ['https://b.com/', 'https://c.com/']);
});

test('reopen-closed-tabs: muting does not replace the closed batch', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: 'https://b.com/', audible: true },
  ]);
  await run(b, 'close-site-tabs', 1);
  await run(b, 'mute-other-tabs', 2);
  assert.equal(await closedCount(b.session), 1);
});

// --- Mute / unmute ---

test('mute-other-tabs: mutes tabs playing sound in all windows (even grouped/pinned), except the target', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://music.com/', audible: true },
    { id: 2, url: 'https://video.com/', audible: true, windowId: 2 },
    { id: 3, url: 'https://quiet.com/' },
    { id: 4, url: 'https://pinned.com/', audible: true, pinned: true, groupId: 3 },
  ]);
  assert.deepEqual(await run(b, 'mute-other-tabs', 1, normalizeSettings({ includeGroupedTabs: false })), [2, 4]);
  assert.deepEqual(b.muted, [2, 4]);
  assert.deepEqual(b.open, [1, 2, 3, 4], 'muting must not close anything');
});

test('mute-other-tabs: second use unmutes what it muted, leaving tabs the user muted alone', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://music.com/', audible: true },
    { id: 2, url: 'https://video.com/', audible: true },
    { id: 3, url: 'https://user.com/', audible: true, mutedInfo: { muted: true, reason: 'user' } },
  ]);
  await run(b, 'mute-other-tabs', 1);
  assert.deepEqual(b.muted, [2, 3]);

  assert.deepEqual(await run(b, 'mute-other-tabs', 1), [2]);
  assert.deepEqual(b.muted, [3], "the user's own mute stays");
});

test('menuState / menu labels follow mute state and the closed batch', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: 'https://a.com/x' },
    { id: 3, url: 'https://b.com/', audible: true },
  ]);
  const labels = async () => {
    const state = menuState(await b.tabs.query({}), await closedCount(b.session), EXTENSION_ID);
    return Object.fromEntries(menuEntries(WORDS, DEFAULTS, state).filter((e) => e.id).map((e) => [e.id, e]));
  };

  let menu = await labels();
  assert.equal(menu['reopen-closed-tabs'].title, 'Reopen closed tabs');
  assert.equal(menu['reopen-closed-tabs'].enabled, false);
  assert.equal(menu['mute-other-tabs'].title, 'Mute other tabs');

  await run(b, 'close-site-tabs', 1);
  await run(b, 'mute-other-tabs', 3); // Nothing else playing: no-op.
  await run(b, 'mute-other-tabs', null); // No active tab: no-op.
  menu = await labels();
  assert.equal(menu['reopen-closed-tabs'].title, 'Reopen 2 closed tabs');
  assert.equal(menu['reopen-closed-tabs'].enabled, true);

  await b.tabs.update(3, { muted: true });
  menu = await labels();
  assert.equal(menu['mute-other-tabs'].title, 'Unmute tabs');
});

// --- Sort tabs by site ---

test('sort-tabs-by-site: alphabetical by site, www ignored, non-web last, pinned untouched', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://zeta.com/', pinned: true },
    { id: 2, url: 'https://c.com/1' },
    { id: 3, url: 'chrome://settings/' },
    { id: 4, url: 'https://www.a.com/' },
    { id: 5, url: 'https://c.com/2' },
    { id: 6, url: 'https://b.com/' },
    { id: 7, url: 'https://a.com/x' },
  ]);
  await run(b, 'sort-tabs-by-site', 2);
  assert.deepEqual(b.strip(), [
    'https://zeta.com/',
    'https://www.a.com/',
    'https://a.com/x',
    'https://b.com/',
    'https://c.com/1',
    'https://c.com/2',
    'chrome://settings/',
  ]);
});

test('sort-tabs-by-site: sorts inside each group and each ungrouped run; no tab changes group', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://d.com/' },
    { id: 2, url: 'https://b.com/' },
    { id: 3, url: 'https://z.com/', groupId: 7 },
    { id: 4, url: 'https://a.com/', groupId: 7 },
    { id: 5, url: 'https://m.com/', groupId: 7 },
    { id: 6, url: 'https://c.com/' },
    { id: 7, url: 'https://a.com/2' },
    { id: 8, url: 'https://y.com/', groupId: 8 },
    { id: 9, url: 'https://x.com/', groupId: 8 },
  ]);
  await run(b, 'sort-tabs-by-site', 1);
  assert.deepEqual(b.strip(), [
    'https://b.com/',
    'https://d.com/',
    'https://a.com/ [g7]',
    'https://m.com/ [g7]',
    'https://z.com/ [g7]',
    'https://a.com/2',
    'https://c.com/',
    'https://x.com/ [g8]',
    'https://y.com/ [g8]',
  ]);
});

test('sort-tabs-by-site: only the clicked tab\'s window, and nothing moves if already sorted', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/' },
    { id: 2, url: 'https://b.com/' },
    { id: 3, url: 'https://z.com/', windowId: 2 },
    { id: 4, url: 'https://y.com/', windowId: 2 },
  ]);
  assert.deepEqual(await run(b, 'sort-tabs-by-site', 1), []);
  assert.deepEqual(b.strip(2), ['https://z.com/', 'https://y.com/']);
});

test('sort-tabs-by-site: does not touch the closed batch', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://x.com/' },
    { id: 2, url: 'https://b.com/' },
    { id: 3, url: 'https://a.com/' },
  ]);
  await run(b, 'close-site-tabs', 1);
  await run(b, 'sort-tabs-by-site', 2);
  assert.equal(await closedCount(b.session), 1);
});

test('unknown action does nothing', async () => {
  const b = fakeBrowser([{ id: 1, url: 'https://a.com/', active: true }]);
  assert.deepEqual(await run(b, 'nope', null), []);
  assert.deepEqual(b.open, [1]);
});

// --- Menu ---

test('menuEntries: all actions by default: close actions, sort/mute, the group actions, then workspaces, with separators between', () => {
  assert.deepEqual(
    menuEntries(WORDS).map((e) => (e.separator ? '---' : e.title)),
    [
      'Close tabs from this site',
      'Close other tabs from this site',
      'Close duplicate tabs',
      'Close tabs not used in 7 days',
      'Close tabs to the left',
      'Reopen closed tabs',
      '---',
      'Sort tabs by site',
      'Mute other tabs',
      '---',
      'Save this window as a group',
      'Close window and keep as group',
      '---',
      'Save windows as workspace',
      'Save this window as workspace',
      'Open workspace',
    ],
  );
});

test('menuEntries: hidden actions are left out, and no dangling separator', () => {
  const settings = normalizeSettings({
    hiddenActions: [
      'mute-other-tabs', 'sort-tabs-by-site', 'close-tabs-to-left', 'save-window-as-group', 'close-window-keep-group',
      'save-workspace', 'save-window-workspace', 'open-workspace',
    ],
  });
  const entries = menuEntries(WORDS, settings);
  assert.equal(entries.some((e) => e.separator), false);
  assert.deepEqual(entries.map((e) => e.id), [
    'close-site-tabs',
    'close-other-site-tabs',
    'close-duplicate-tabs',
    'close-inactive-tabs',
    'reopen-closed-tabs',
  ]);
  assert.deepEqual(menuEntries(WORDS, normalizeSettings({ hiddenActions: ACTIONS.map((a) => a.id) })), []);
});

test('menuTitle: inactive label follows the days setting, with correct plural', () => {
  const inactive = action('close-inactive-tabs');
  assert.equal(menuTitle(inactive, WORDS, normalizeSettings({ inactiveDays: 1 })), 'Close tabs not used in 1 day');
  assert.equal(menuTitle(inactive, WORDS, normalizeSettings({ inactiveDays: 30 })), 'Close tabs not used in 30 days');
  const reopen = action('reopen-closed-tabs');
  assert.equal(menuTitle(reopen, WORDS, DEFAULTS, { ...NO_STATE, closedCount: 1 }), 'Reopen 1 closed tab');
});

// --- Manifest ---

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('manifest: every action has a matching command described by the action’s own message, plus the shortcut-only "switch to last used tab"', () => {
  const commands = manifest.commands;
  // "Switch to last used tab" has no menu item: it's only useful from the keyboard.
  assert.deepEqual(Object.keys(commands).sort(), [...ACTIONS.map((a) => a.id), SWITCH_LAST].sort());
  for (const action of ACTIONS) assert.equal(commands[action.id].description, `__MSG_${action.message}__`);
  assert.equal(commands[SWITCH_LAST].description, `__MSG_${SWITCH_LAST_MESSAGE}__`);
  assert.deepEqual(
    [SWITCH_LAST_MESSAGE, ...ACTIONS.map((a) => a.message)].map((key) => WORDS.t(key)),
    [
      'Switch to last used tab', 'Close tabs from this site', 'Close other tabs from this site', 'Close duplicate tabs',
      'Close inactive tabs', 'Close tabs to the left', 'Reopen closed tabs', 'Sort tabs by site', 'Mute or unmute other tabs',
      'Save this window as a group', 'Close window and keep as group', 'Save windows as workspace',
      'Save this window as workspace', 'Open last workspace',
    ],
    'as Chrome’s Keyboard shortcuts page lists them',
  );
});

test('manifest: its name, description and toolbar title are messages, within Chrome Web Store limits', () => {
  assert.deepEqual(
    [manifest.name, manifest.short_name, manifest.description, manifest.action.default_title, manifest.default_locale],
    ['__MSG_extName__', '__MSG_extShortName__', '__MSG_extDescription__', '__MSG_toolbarTitle__', 'en'],
  );
  assert.equal(WORDS.t('extName'), 'Better Tab Actions');
  assert.equal(WORDS.t('toolbarTitle'), 'Better Tab Actions settings');
  assert.ok(WORDS.t('extName').length <= 75);
  assert.ok(WORDS.t('extDescription').length <= 132, `description is ${WORDS.t('extDescription').length} chars`);
});
