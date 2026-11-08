import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, UNSYNCED, loadSettings } from '../settings.js';
import { OLD_SWITCH, OLD_SYNC_ITEM, moveSettingsToSync } from '../migrate.js';
import { fakeChromeStorage } from './fake-browser.js';

/** What the last build saved in local: every setting, normalised, plus the opt-in switch. */
const lastBuild = (changes, switchOn = false) => ({ ...DEFAULTS, ...changes, [OLD_SWITCH]: switchOn });

test('local only: the settings move to sync, and local is left empty', async () => {
  const mine = { hiddenActions: ['sort-tabs-by-site'], inactiveDays: 21, windowScope: 'all' };
  const storage = fakeChromeStorage({ local: lastBuild(mine) });
  await moveSettingsToSync(storage);
  assert.deepEqual(storage.sync.data, { ...DEFAULTS, ...mine });
  assert.deepEqual(storage.local.data, {});
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, ...mine });
});

test('sync already holds settings (another computer): sync wins', async () => {
  const theirs = { ...DEFAULTS, inactiveDays: 3, includeGroupedTabs: false };
  const storage = fakeChromeStorage({ local: lastBuild({ inactiveDays: 21 }), sync: theirs });
  await moveSettingsToSync(storage);
  assert.deepEqual(await loadSettings(storage), theirs);
  assert.deepEqual(storage.sync.data, theirs);
  assert.deepEqual(storage.local.data, {});
});

test('sync holds some settings: those win, this computer’s fill in the rest', async () => {
  const storage = fakeChromeStorage({
    local: lastBuild({ inactiveDays: 21, hiddenActions: ['mute-other-tabs'] }),
    sync: { inactiveDays: 3 },
  });
  await moveSettingsToSync(storage);
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, inactiveDays: 3, hiddenActions: ['mute-other-tabs'] });
});

test('the old switch’s mirrored item: taken as sync’s, then removed', async () => {
  const mirrored = { ...DEFAULTS, windowScope: 'all', inactiveDays: 'junk' };
  const storage = fakeChromeStorage({
    local: lastBuild({ windowScope: 'window', inactiveDays: 21 }),
    sync: { [OLD_SYNC_ITEM]: mirrored },
  });
  await moveSettingsToSync(storage);
  // Junk never reaches sync: this computer's own value stays instead.
  assert.deepEqual(storage.sync.data, { ...DEFAULTS, windowScope: 'all', inactiveDays: 21 });
  assert.equal(OLD_SYNC_ITEM in storage.sync.data, false);
  assert.deepEqual(storage.local.data, {});
});

test('the first builds’ settings, still in sync one item each, stay as they are', async () => {
  const first = { hiddenActions: ['close-tabs-to-left'], windowScope: 'all' };
  const storage = fakeChromeStorage({ sync: first });
  await moveSettingsToSync(storage);
  assert.deepEqual(storage.sync.data, first);
  assert.equal(storage.sync.writes, 0);
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, ...first });
});

test('running it twice changes nothing more, and the second run writes nothing', async () => {
  const storage = fakeChromeStorage({ local: lastBuild({ inactiveDays: 21 }, true), sync: { [OLD_SYNC_ITEM]: DEFAULTS } });
  await moveSettingsToSync(storage);
  const after = { sync: structuredClone(storage.sync.data), local: structuredClone(storage.local.data) };
  const writes = storage.sync.writes;
  await moveSettingsToSync(storage);
  assert.deepEqual({ sync: storage.sync.data, local: storage.local.data }, after);
  assert.equal(storage.sync.writes, writes);
});

test('a fresh install: nothing to move, nothing written', async () => {
  const storage = fakeChromeStorage();
  await moveSettingsToSync(storage);
  assert.equal(storage.sync.writes, 0);
  assert.deepEqual(storage.local.data, {});
});

test('sync refuses the move: no setting is lost, and the next run puts them in sync', async () => {
  let t = 0;
  const storage = fakeChromeStorage({ local: lastBuild({ inactiveDays: 21, windowScope: 'all' }), now: () => t });
  for (let i = 0; i < 120; i++) await storage.sync.set({ filler: i });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await moveSettingsToSync(storage);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, inactiveDays: 21, windowScope: 'all' });
  assert.deepEqual(Object.keys(storage.local.data), [UNSYNCED]);

  t += 61_000;
  await moveSettingsToSync(storage); // The next startup.
  assert.deepEqual(storage.local.data, {});
  assert.equal(storage.sync.data.inactiveDays, 21);
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, inactiveDays: 21, windowScope: 'all' });
});
