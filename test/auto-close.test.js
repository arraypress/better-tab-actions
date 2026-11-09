/**
 * "Close unused tabs automatically": which tabs it closes and keeps, that closed tabs join the
 * "Reopen closed tabs" batch (and come back in place), and the alarm following the setting.
 *
 * @module test/auto-close
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_CLOSE_ALARM, CHECK_MINUTES, closeUnusedTabs, HOUR_MS, scheduleAutoClose, unusedTabs } from '../extension/background/auto-close.js';
import { normalizeSettings } from '../extension/shared/settings.js';
import { closedCount, MAX_CLOSED, recordClosed } from '../extension/shared/undo.js';
import { fakeBrowser, runOn } from './fake-browser.js';

/** @import { Settings } from '../extension/shared/settings.js' */
/** @import { AlarmsApi } from '../extension/background/auto-close.js' */

const NOW = Date.UTC(2026, 10, 9, 12);
const OLD = NOW - 5 * HOUR_MS;
const RECENT = NOW - 30 * 60 * 1000;

/**
 * Settings with automatic closing on after 4 hours, plus any changes.
 *
 * @param {Partial<Settings>} [changes] - What differs.
 * @returns {Settings} The settings.
 */
const on = (changes = {}) => normalizeSettings({ autoClose: true, autoCloseHours: 4, ...changes });

test('unusedTabs: closes tabs unused for the chosen time; keeps the active, pinned, playing, recent, untimed, listed-site and incognito ones', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', lastAccessed: OLD },
    { id: 2, url: 'https://b.com/', lastAccessed: OLD, active: true },
    { id: 3, url: 'https://c.com/', lastAccessed: OLD, pinned: true },
    { id: 4, url: 'https://music.com/', lastAccessed: OLD, audible: true },
    { id: 5, url: 'https://d.com/', lastAccessed: RECENT },
    { id: 6, url: 'https://e.com/' },
    { id: 7, url: 'https://docs.github.com/', lastAccessed: OLD },
    { id: 8, url: 'https://github.com/', lastAccessed: OLD },
    { id: 9, url: 'https://notgithub.com/', lastAccessed: OLD },
    { id: 10, url: 'https://f.com/', lastAccessed: OLD, windowId: 2, active: true },
    { id: 11, url: 'https://g.com/', lastAccessed: OLD, windowId: 2 },
    { id: 12, url: 'https://private.com/', lastAccessed: OLD, windowId: 3, incognito: true },
  ]);
  const tabs = await b.tabs.query({});
  const closed = (/** @type {Settings} */ settings) => unusedTabs(tabs, settings, NOW).map((tab) => tab.id);
  assert.deepEqual(closed(on({ keepSites: ['github.com'] })), [1, 9, 11]);
  assert.deepEqual(closed(on()), [1, 7, 8, 9, 11]);
  assert.deepEqual(closed(on({ autoCloseHours: 12 })), [], 'none unused for 12 hours');
  assert.deepEqual(closed(normalizeSettings({ autoCloseHours: 4 })), [], 'off: nothing');
});

test('unusedTabs: grouped tabs follow “Include tabs in groups”', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', lastAccessed: OLD, active: true },
    { id: 2, url: 'https://b.com/', lastAccessed: OLD, groupId: 7 },
    { id: 3, url: 'https://c.com/', lastAccessed: OLD },
  ]);
  const tabs = await b.tabs.query({});
  assert.deepEqual(unusedTabs(tabs, on(), NOW).map((tab) => tab.id), [2, 3]);
  assert.deepEqual(unusedTabs(tabs, on({ includeGroupedTabs: false }), NOW).map((tab) => tab.id), [3]);
});

test('closeUnusedTabs: closed tabs join the “Reopen closed tabs” batch, and come back in their places and groups', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', lastAccessed: NOW, active: true },
    { id: 2, url: 'https://b.com/', lastAccessed: OLD },
    { id: 3, url: 'https://c.com/', lastAccessed: NOW },
    { id: 4, url: 'https://d.com/', lastAccessed: OLD },
  ]);
  // A batch from a menu action, still waiting to be reopened, and a group to come back to.
  await runOn(b, 'close-site-tabs', 3, { now: NOW });
  const groupId = await b.tabs.group({ tabIds: [1, 4] });
  assert.deepEqual(b.strip(), [`https://a.com/ [g${groupId}]`, `https://d.com/ [g${groupId}]`, 'https://b.com/']);

  assert.deepEqual(await closeUnusedTabs(b, on(), NOW), [4, 2]);
  assert.deepEqual(b.strip(), [`https://a.com/ [g${groupId}]`]);
  assert.equal(await closedCount(b.session), 3, 'added to the batch the menu action left');

  await runOn(b, 'reopen-closed-tabs', null, { now: NOW });
  assert.deepEqual(b.strip(), [`https://a.com/ [g${groupId}]`, `https://d.com/ [g${groupId}]`, 'https://b.com/', 'https://c.com/']);
  assert.deepEqual(await closeUnusedTabs(b, on(), NOW), [], 'reopened tabs have no last-used time yet, so they stay');
});

test('recordClosed: appending keeps the earlier tabs, up to MAX_CLOSED, newest kept', async () => {
  const b = fakeBrowser(Array.from({ length: MAX_CLOSED + 3 }, (_, i) => ({ id: i + 1, url: `https://t${i}.com/` })));
  const tabs = await b.tabs.query({});
  await recordClosed(b.session, tabs.slice(0, 3), NOW);
  await recordClosed(b.session, tabs.slice(3), NOW, { append: true });
  assert.equal(await closedCount(b.session), MAX_CLOSED);
  await recordClosed(b.session, tabs.slice(0, 2), NOW);
  assert.equal(await closedCount(b.session), 2, 'a menu action starts a new batch');
});

/**
 * An in-memory chrome.alarms: the alarms by name.
 *
 * @returns {AlarmsApi & {all: Map<string, chrome.alarms.Alarm>, readonly creates: number}} The fake.
 */
function fakeAlarms() {
  /** @type {Map<string, chrome.alarms.Alarm>} */
  const all = new Map();
  let creates = 0;
  return {
    all,
    get creates() {
      return creates;
    },
    async get(name) {
      return all.get(name);
    },
    async create(name, { periodInMinutes, delayInMinutes = 0 }) {
      creates++;
      all.set(name, { name, periodInMinutes, scheduledTime: NOW + delayInMinutes * 60_000, persistAcrossSessions: true });
    },
    async clear(name) {
      return all.delete(name);
    },
  };
}

test('scheduleAutoClose: an alarm every CHECK_MINUTES while on, left alone when the worker wakes, none while off', async () => {
  const alarms = fakeAlarms();
  await scheduleAutoClose(alarms, on());
  assert.equal(alarms.all.get(AUTO_CLOSE_ALARM)?.periodInMinutes, CHECK_MINUTES);
  await scheduleAutoClose(alarms, on());
  assert.equal(alarms.creates, 1, 'not pushed back');
  await scheduleAutoClose(alarms, on({ autoClose: false }));
  assert.equal(alarms.all.size, 0);
});
