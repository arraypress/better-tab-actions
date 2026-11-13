/**
 * "Close unused tabs automatically": which tabs it closes and keeps, that only time Chrome was
 * running and awake counts (a night's sleep, Chrome closed for a day, the time before it was
 * turned on), that closed tabs join the "Reopen closed tabs" batch (and come back in place), and
 * the alarm and the awake clock following the setting. Time is the `now` each check is given.
 *
 * @module test/auto-close
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_CLOSE_ALARM, AWAKE_KEY, awakeTime, CHECK_MINUTES, closeUnusedTabs, GAP_MS, HOUR_MS, loadClock, MAX_AWAY, scheduleAutoClose,
  startClock, tickClock, unusedTabs,
} from '../extension/background/auto-close.js';
import { normalizeSettings } from '../extension/shared/settings.js';
import { closedCount, MAX_CLOSED, recordClosed } from '../extension/shared/undo.js';
import { fakeBrowser, runOn } from './fake-browser.js';
import { fakeAlarms } from './fake-chrome.js';

/** @import { Settings } from '../extension/shared/settings.js' */

const NOW = Date.UTC(2026, 10, 9, 12);
const OLD = NOW - 5 * HOUR_MS;
const RECENT = NOW - 30 * 60 * 1000;
/** The time between two checks while Chrome is running and awake. */
const CHECK_MS = CHECK_MINUTES * 60 * 1000;
/** A clock that has watched for a month without a gap: every tab's idle time counts in full. */
const WATCHING = Object.freeze({ since: NOW - 30 * 24 * HOUR_MS, tick: NOW - CHECK_MS, away: [] });

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
  const closed = (/** @type {Settings} */ settings) => unusedTabs(tabs, settings, NOW, WATCHING).map((tab) => tab.id);
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
  assert.deepEqual(unusedTabs(tabs, on(), NOW, WATCHING).map((tab) => tab.id), [2, 3]);
  assert.deepEqual(unusedTabs(tabs, on({ includeGroupedTabs: false }), NOW, WATCHING).map((tab) => tab.id), [3]);
});

test('closeUnusedTabs: closed tabs join the “Reopen closed tabs” batch, and come back in their places and groups', async () => {
  const b = fakeBrowser([
    { id: 1, url: 'https://a.com/', lastAccessed: NOW, active: true },
    { id: 2, url: 'https://b.com/', lastAccessed: OLD },
    { id: 3, url: 'https://c.com/', lastAccessed: NOW },
    { id: 4, url: 'https://d.com/', lastAccessed: OLD },
  ]);
  await b.local.set({ [AWAKE_KEY]: WATCHING });
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
  await recordClosed(b.session, tabs.slice(0, 3));
  await recordClosed(b.session, tabs.slice(3), { append: true });
  assert.equal(await closedCount(b.session), MAX_CLOSED);
  await recordClosed(b.session, tabs.slice(0, 2));
  assert.equal(await closedCount(b.session), 2, 'a menu action starts a new batch');
});

/**
 * Turn automatic closing on at `at` (as the worker does when the setting changes), in a browser
 * with a tab in front and one in the background, both last used then.
 *
 * @param {number} at - When, in ms since the epoch.
 * @param {Settings} settings - The settings, automatic closing on.
 * @param {number} [lastAccessed] - When the tabs were last used. Default `at`.
 */
async function turnedOn(at, settings, lastAccessed = at) {
  const b = fakeBrowser([
    { id: 1, url: 'https://front.com/', lastAccessed, active: true },
    { id: 2, url: 'https://back.com/', lastAccessed },
  ]);
  await scheduleAutoClose({ alarms: fakeAlarms(at), local: b.local }, settings, at);
  return b;
}

/**
 * Chrome running with the computer awake from `from` to `to`: a check every CHECK_MINUTES, as
 * the alarm fires.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The browser.
 * @param {Settings} settings - The settings.
 * @param {number} from - The first check.
 * @param {number} to - The last one, at the latest.
 * @returns {Promise<number[]>} The tabs closed, in order.
 */
async function awake(b, settings, from, to) {
  /** @type {number[]} */
  const closed = [];
  for (let now = from; now <= to; now += CHECK_MS) closed.push(...await closeUnusedTabs(b, settings, now));
  return closed;
}

const SIX_PM = Date.UTC(2026, 10, 9, 18);

test('normal use: each check ticks the clock, and a tab closes once it has gone unused for the chosen time', async () => {
  const b = await turnedOn(SIX_PM, on());
  assert.deepEqual(await awake(b, on(), SIX_PM + CHECK_MS, SIX_PM + 4 * HOUR_MS - CHECK_MS), [], 'not yet four hours');
  assert.deepEqual(await loadClock(b.local), { since: SIX_PM, tick: SIX_PM + 4 * HOUR_MS - CHECK_MS, away: [] }, 'awake all along');
  assert.deepEqual(await closeUnusedTabs(b, on(), SIX_PM + 4 * HOUR_MS), [2]);
  assert.deepEqual(b.open, [1]);
});

test('the computer asleep overnight: the night doesn’t count, so the morning’s first check closes nothing', async () => {
  const b = await turnedOn(SIX_PM, on());
  await awake(b, on(), SIX_PM + CHECK_MS, SIX_PM + HOUR_MS); // An hour's use, then the lid is shut at 7 pm.
  const morning = SIX_PM + 13 * HOUR_MS; // 7 am: the missed alarm fires once as the computer wakes.
  assert.deepEqual(await closeUnusedTabs(b, on(), morning), [], 'unused for 13 hours by the wall clock, 1 hour of them awake');
  assert.deepEqual((await loadClock(b.local))?.away, [[SIX_PM + HOUR_MS, morning]]);

  assert.deepEqual(await awake(b, on(), morning + CHECK_MS, morning + 3 * HOUR_MS - CHECK_MS), [], 'not yet four hours awake');
  assert.deepEqual(await closeUnusedTabs(b, on(), morning + 3 * HOUR_MS), [2], 'one hour in the evening and three in the morning');
});

test('Chrome closed for a day: the clock is kept on this computer, so the day doesn’t count when Chrome starts again', async () => {
  const b = await turnedOn(SIX_PM, on({ autoCloseHours: 12 }));
  const settings = on({ autoCloseHours: 12 });
  await awake(b, settings, SIX_PM + CHECK_MS, SIX_PM + 2 * HOUR_MS);
  await b.session.clear(); // Chrome quits: session storage goes, local stays.
  const nextDay = SIX_PM + 26 * HOUR_MS;
  // Chrome starts: the worker looks at the schedule (the clock is left running), then the alarm fires.
  await scheduleAutoClose({ alarms: fakeAlarms(nextDay), local: b.local }, settings, nextDay);
  assert.deepEqual(await closeUnusedTabs(b, settings, nextDay), [], 'unused for 26 hours by the wall clock, 2 of them with Chrome running');
  assert.deepEqual(await loadClock(b.local), { since: SIX_PM, tick: nextDay, away: [[SIX_PM + 2 * HOUR_MS, nextDay]] });
  assert.deepEqual(await awake(b, settings, nextDay + CHECK_MS, nextDay + 10 * HOUR_MS), [2], 'after ten more hours of use');
  assert.equal((await loadClock(b.local))?.tick, nextDay + 10 * HOUR_MS, 'closed at the twelfth hour, not before');
});

test('turned on with tabs already unused for a week: time before it was on doesn’t count either', async () => {
  const b = await turnedOn(SIX_PM, on(), SIX_PM - 7 * 24 * HOUR_MS);
  assert.deepEqual(await awake(b, on(), SIX_PM + CHECK_MS, SIX_PM + 4 * HOUR_MS - CHECK_MS), []);
  assert.deepEqual(await closeUnusedTabs(b, on(), SIX_PM + 4 * HOUR_MS), [2]);
});

test('the awake clock: gaps become away time, short delays don’t; the oldest stretches fold into “before it was on”', () => {
  const clock = startClock(1000);
  assert.deepEqual(tickClock(clock, 1000 + GAP_MS), { since: 1000, tick: 1000 + GAP_MS, away: [] }, 'an alarm a little late is no gap');
  assert.deepEqual(tickClock(clock, 1001 + GAP_MS).away, [[1000, 1001 + GAP_MS]]);
  assert.deepEqual(tickClock({ since: 1000, tick: 5000, away: [] }, 4000), { since: 1000, tick: 4000, away: [] }, 'the computer’s clock put back');

  assert.equal(awakeTime({ since: 0, tick: 90, away: [[20, 80]] }, 10, 100), 30);
  assert.equal(awakeTime({ since: 50, tick: 90, away: [] }, 10, 100), 50, 'nothing from before it was on');
  assert.equal(awakeTime({ since: 0, tick: 90, away: [[20, 80]] }, 60, 100), 20, 'only the part of a stretch after the tab was used');

  /** @type {[number, number][]} */
  const away = Array.from({ length: MAX_AWAY }, (_, i) => [i * 10, i * 10 + 5]);
  const full = tickClock({ since: 0, tick: MAX_AWAY * 10, away }, MAX_AWAY * 10 + 2 * GAP_MS);
  assert.equal(full.away.length, MAX_AWAY);
  assert.equal(full.since, 5, 'everything up to the dropped stretch’s end counts as away');
});

test('scheduleAutoClose: an alarm every CHECK_MINUTES and a clock while on, both left alone when the worker wakes, neither while off', async () => {
  const alarms = fakeAlarms();
  const b = fakeBrowser([]);
  const apis = { alarms, local: b.local };
  await scheduleAutoClose(apis, on(), NOW);
  assert.equal(alarms.all.get(AUTO_CLOSE_ALARM)?.periodInMinutes, CHECK_MINUTES);
  assert.deepEqual(await loadClock(b.local), startClock(NOW));
  await scheduleAutoClose(apis, on(), NOW + HOUR_MS);
  assert.equal(alarms.creates, 1, 'not pushed back');
  assert.deepEqual(await loadClock(b.local), startClock(NOW), 'the clock keeps running');
  await scheduleAutoClose(apis, on({ autoClose: false }), NOW + HOUR_MS);
  assert.equal(alarms.all.size, 0);
  assert.deepEqual(b.local.data, {}, 'nothing kept while it’s off');
  await b.local.set({ [AWAKE_KEY]: 'junk' });
  await scheduleAutoClose(apis, on(), NOW + 2 * HOUR_MS);
  assert.deepEqual(await loadClock(b.local), startClock(NOW + 2 * HOUR_MS), 'on again: watching starts afresh');
});
