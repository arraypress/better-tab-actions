import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, UNSYNCED, changedSettings, loadSettings, normalizeSettings, retryUnsynced, saveSettings, settingsSaver,
} from '../settings.js';
import { fakeChromeStorage } from './fake-browser.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A clock the fake's sync write limit reads; tests move it on. */
const clock = () => {
  let t = 1_000_000;
  return { now: () => t, pass: (ms) => { t += ms; } };
};

test('defaults: every action shown, this window, 7 days, grouped tabs included', () => {
  assert.deepEqual(DEFAULTS, {
    hiddenActions: [],
    inactiveDays: 7,
    windowScope: 'window',
    includeGroupedTabs: true,
  });
});

test('normalizeSettings: fills missing values from defaults', () => {
  assert.deepEqual(normalizeSettings({}), DEFAULTS);
  assert.deepEqual(normalizeSettings(undefined), DEFAULTS);
});

test('normalizeSettings: rejects junk and clamps days to 1–365', () => {
  const s = normalizeSettings({
    hiddenActions: ['a', 3, 'a', null],
    inactiveDays: '0',
    windowScope: 'everywhere',
    includeGroupedTabs: 'yes',
  });
  assert.deepEqual(s, { ...DEFAULTS, hiddenActions: ['a'], inactiveDays: 1 });
  assert.equal(normalizeSettings({ inactiveDays: 9999 }).inactiveDays, 365);
  assert.equal(normalizeSettings({ inactiveDays: '14.4' }).inactiveDays, 14);
  assert.equal(normalizeSettings({ inactiveDays: 'abc' }).inactiveDays, 7);
});

test('loadSettings: empty storage gives defaults', async () => {
  assert.deepEqual(await loadSettings(fakeChromeStorage()), DEFAULTS);
});

test('saveSettings: goes to Chrome Sync, one item per setting, normalised; nothing in local', async () => {
  const storage = fakeChromeStorage({ sync: { windowScope: 'all' } });
  const { settings, synced } = await saveSettings(storage, { inactiveDays: '30' });
  assert.equal(synced, true);
  assert.deepEqual(settings, { ...DEFAULTS, windowScope: 'all', inactiveDays: 30 });
  assert.deepEqual(await loadSettings(storage), settings);
  assert.deepEqual(storage.sync.data, { windowScope: 'all', inactiveDays: 30 });
  assert.deepEqual(storage.local.data, {});
  assert.equal(storage.sync.writes, 1);
});

test('saveSettings: writes only what changed, so another computer’s change meanwhile survives', async () => {
  const storage = fakeChromeStorage();
  const page = await loadSettings(storage); // The options page, opened here.
  await storage.sync.set({ windowScope: 'all' }); // Then another computer changes the windows.
  await saveSettings(storage, { inactiveDays: 3 }); // And the page changes the days.
  assert.deepEqual(page, DEFAULTS);
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, windowScope: 'all', inactiveDays: 3 });
});

test('a value a newer version wrote is shown as the default but left in sync until changed here', async () => {
  const storage = fakeChromeStorage({ sync: { windowScope: 'pinned-only' } });
  assert.equal((await loadSettings(storage)).windowScope, 'window');
  await saveSettings(storage, { inactiveDays: 10 });
  assert.equal(storage.sync.data.windowScope, 'pinned-only');
});

test('another computer’s change is seen as a settings change, and read', async () => {
  const storage = fakeChromeStorage();
  const seen = [];
  storage.onChanged.addListener((changes, area) => seen.push(...changedSettings(changes, area)));
  await storage.sync.set({ hiddenActions: ['sort-tabs-by-site'] }); // Arriving through Chrome Sync.
  await storage.local.set({ somethingElse: 1 });
  await storage.settled();
  assert.deepEqual(seen, ['hiddenActions']);
  assert.deepEqual((await loadSettings(storage)).hiddenActions, ['sort-tabs-by-site']);
});

test('sync refuses a write (too many a minute): the change is kept here, still read, then retried', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const time = clock();
  const storage = fakeChromeStorage({ now: time.now });
  for (let i = 0; i < 120; i++) await storage.sync.set({ filler: i }); // The minute's writes, used up.

  const { synced } = await saveSettings(storage, { windowScope: 'all' });
  assert.equal(synced, false);
  assert.equal(storage.sync.data.windowScope, undefined);
  assert.deepEqual(storage.local.data[UNSYNCED], { windowScope: 'all' });
  assert.equal((await loadSettings(storage)).windowScope, 'all'); // Works on this computer meanwhile.

  // Another change while sync still refuses: both are kept.
  await saveSettings(storage, { inactiveDays: 30 });
  assert.deepEqual(storage.local.data[UNSYNCED], { windowScope: 'all', inactiveDays: 30 });

  time.pass(61_000);
  assert.equal(await retryUnsynced(storage), true);
  assert.deepEqual(storage.sync.data, { filler: 119, windowScope: 'all', inactiveDays: 30 });
  assert.equal(UNSYNCED in storage.local.data, false);
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, windowScope: 'all', inactiveDays: 30 });
});

test('a setting too big for one sync item stays here; the others still sync', async () => {
  const storage = fakeChromeStorage();
  const hiddenActions = Array.from({ length: 900 }, (_, i) => `action-number-${i}`);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { synced } = await saveSettings(storage, { hiddenActions, windowScope: 'all' });
    assert.equal(synced, false);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(storage.sync.data, { windowScope: 'all' });
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, hiddenActions, windowScope: 'all' });
});

test('every action hidden still fits in one sync item', async () => {
  const { ACTIONS } = await import('../actions.js');
  const storage = fakeChromeStorage();
  const { synced } = await saveSettings(storage, { hiddenActions: ACTIONS.map((a) => a.id) });
  assert.equal(synced, true);
  assert.equal(storage.sync.data.hiddenActions.length, ACTIONS.length);
});

// --- The options page's saver ---

test('saver: a burst of toggles is one sync write, of the last state', async () => {
  const storage = fakeChromeStorage();
  const saved = [];
  const saver = settingsSaver(storage, { delay: 20, onSaved: (s) => saved.push(s) });
  for (let i = 0; i < 150; i++) saver.save({ includeGroupedTabs: i % 2 === 0, inactiveDays: i + 1 });
  assert.deepEqual(saver.pending, { includeGroupedTabs: false, inactiveDays: 150 });
  assert.equal(storage.sync.writes, 0);
  await wait(60);
  await saver.flush();
  assert.equal(storage.sync.writes, 1);
  assert.deepEqual(storage.sync.data, { includeGroupedTabs: false, inactiveDays: 150 });
  assert.equal(saved.length, 1);
  assert.deepEqual(saver.pending, {});
});

test('saver: the same burst without the debounce runs into sync’s write limit', async () => {
  const storage = fakeChromeStorage();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const results = [];
    for (let i = 0; i < 150; i++) results.push((await saveSettings(storage, { includeGroupedTabs: i % 2 === 0 })).synced);
    assert.ok(results.includes(false));
  } finally {
    console.warn = warn;
  }
});

test('saver: flush() writes at once (the page is closing)', async () => {
  const storage = fakeChromeStorage();
  const saver = settingsSaver(storage, { delay: 10_000 });
  saver.save({ windowScope: 'all' });
  await saver.flush();
  assert.equal(storage.sync.data.windowScope, 'all');
  saver.stop();
});

test('saver: a refused write is kept here and retried until sync takes it', async () => {
  const time = clock();
  const storage = fakeChromeStorage({ now: time.now });
  for (let i = 0; i < 120; i++) await storage.sync.set({ filler: i });
  const warn = console.warn;
  console.warn = () => {};
  const saver = settingsSaver(storage, { delay: 5, retryAfter: 20 });
  try {
    saver.save({ inactiveDays: 14 });
    await saver.flush();
    assert.deepEqual(storage.local.data[UNSYNCED], { inactiveDays: 14 });
    await wait(50); // A retry or two, still within the minute: still kept.
    assert.deepEqual(storage.local.data[UNSYNCED], { inactiveDays: 14 });

    time.pass(61_000);
    await wait(50);
    assert.equal(storage.sync.data.inactiveDays, 14);
    assert.equal(UNSYNCED in storage.local.data, false);
  } finally {
    saver.stop();
    console.warn = warn;
  }
});
