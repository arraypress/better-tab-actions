/**
 * More Tab Actions' own settings: the schema and how the store keeps it. The store's general
 * behaviour (refused writes, the debounced saver) is tested in @arraypress/extension-kit.
 *
 * @module test/settings
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeChromeStorage } from '@arraypress/extension-kit/testing';
import { ACTIONS } from '../extension/shared/actions.js';
import { DEFAULTS, normalizeSettings, settingsStore } from '../extension/shared/settings.js';

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
