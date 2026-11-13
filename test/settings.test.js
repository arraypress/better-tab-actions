/**
 * Better Tab Actions' own settings: the schema and how the store keeps it. The store's general
 * behaviour (refused writes, the debounced saver) is tested in @arraypress/extension-kit.
 *
 * @module test/settings
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeChromeStorage } from '@arraypress/extension-kit/testing';
import { ACTIONS } from '../extension/shared/actions.js';
import { AUTO_CLOSE_HOURS, DEFAULTS, normalizeSettings, settingsStore } from '../extension/shared/settings.js';

test('defaults: every action shown, this window, 7 days, grouped tabs included, no automatic closing, workspaces’ groups reopened', () => {
  assert.deepEqual(DEFAULTS, {
    hiddenActions: [],
    inactiveDays: 7,
    windowScope: 'window',
    includeGroupedTabs: true,
    autoClose: false,
    autoCloseHours: 168,
    keepSites: [],
    reopenGroups: true,
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
    reopenGroups: 'no',
    autoClose: 1,
    autoCloseHours: 5,
    keepSites: 'github.com',
  });
  assert.deepEqual(s, { ...DEFAULTS, hiddenActions: ['a'], inactiveDays: 1 });
  assert.equal(normalizeSettings({ inactiveDays: 9999 }).inactiveDays, 365);
  assert.equal(normalizeSettings({ inactiveDays: '14.4' }).inactiveDays, 14);
  assert.equal(normalizeSettings({ inactiveDays: 'abc' }).inactiveDays, 7);
  assert.equal(normalizeSettings({ reopenGroups: false }).reopenGroups, false);
});

test('normalizeSettings: what holds no number (an emptied field, null, true) takes the default, not 1', () => {
  // Number('') and Number(null) are 0, Number(true) is 1: an emptied days field became “1 day”.
  for (const junk of ['', '  ', null, true, false, [], {}]) {
    assert.equal(normalizeSettings({ inactiveDays: junk }).inactiveDays, DEFAULTS.inactiveDays, JSON.stringify(junk));
    assert.equal(normalizeSettings({ autoCloseHours: junk }).autoCloseHours, DEFAULTS.autoCloseHours, JSON.stringify(junk));
  }
  assert.equal(normalizeSettings({ inactiveDays: ' 12 ' }).inactiveDays, 12);
  assert.equal(normalizeSettings({ autoCloseHours: '1' }).autoCloseHours, 1);
});

test('every setting is synced: none is tied to one computer', () => {
  assert.deepEqual(settingsStore.localKeys, []);
  assert.deepEqual(settingsStore.syncedKeys, Object.keys(DEFAULTS));
});

test('saving: goes to Chrome Sync, one item per setting, normalised; nothing in local', async () => {
  const storage = fakeChromeStorage({ sync: { windowScope: 'all' } });
  const { settings, synced } = await settingsStore.save(storage, { inactiveDays: /** @type {any} */ ('30') });
  assert.equal(synced, true);
  assert.deepEqual(settings, { ...DEFAULTS, windowScope: 'all', inactiveDays: 30 });
  assert.deepEqual(await settingsStore.load(storage), settings);
  assert.deepEqual(storage.sync.data, { windowScope: 'all', inactiveDays: 30 });
  assert.deepEqual(storage.local.data, {});
  assert.equal(storage.sync.writes, 1);
});

test('another computer’s change is seen as a settings change, and read', async () => {
  const storage = fakeChromeStorage();
  /** @type {string[]} */
  const seen = [];
  storage.onChanged.addListener((changes, area) => seen.push(...settingsStore.changed(changes, area)));
  await storage.sync.set({ hiddenActions: ['sort-tabs-by-site'] }); // Arriving through Chrome Sync.
  await storage.local.set({ somethingElse: 1 });
  await storage.settled();
  assert.deepEqual(seen, ['hiddenActions']);
  assert.deepEqual((await settingsStore.load(storage)).hiddenActions, ['sort-tabs-by-site']);
});

test('every action hidden still fits in one sync item', async () => {
  const storage = fakeChromeStorage();
  const { synced } = await settingsStore.save(storage, { hiddenActions: ACTIONS.map((a) => a.id) });
  assert.equal(synced, true);
  assert.equal(storage.sync.data.hiddenActions.length, ACTIONS.length);
});

test('normalizeSettings: automatic closing takes an offered age and valid sites, without repeats', () => {
  assert.deepEqual(AUTO_CLOSE_HOURS, [1, 4, 12, 24, 72, 168]);
  const s = normalizeSettings({ autoClose: true, autoCloseHours: '12', keepSites: ['https://www.GitHub.com/x', 'github.com', 'not a site', 3, 'docs.example'] });
  assert.deepEqual([s.autoClose, s.autoCloseHours, s.keepSites], [true, 12, ['github.com', 'docs.example']]);
});

test('kept sites: cut where the list would no longer fit one sync item, so it always syncs', async () => {
  const sites = Array.from({ length: 200 }, (_, i) => `site-number-${i}-${'x'.repeat(60)}.example`);
  const { keepSites } = normalizeSettings({ keepSites: sites });
  assert.ok(keepSites.length > 50 && keepSites.length < 200);
  assert.deepEqual(keepSites, sites.slice(0, keepSites.length));
  const storage = fakeChromeStorage();
  assert.equal((await settingsStore.save(storage, { keepSites: sites })).synced, true);
});
