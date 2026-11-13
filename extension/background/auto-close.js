/**
 * "Close unused tabs automatically": every few minutes (a `chrome.alarms` alarm, while the
 * setting is on) the tabs nobody has used for the chosen time are closed, across normal windows.
 * They're added to the "Reopen closed tabs" batch, so they come back in their places and groups.
 *
 * Kept open: each window's active tab, pinned tabs, tabs playing sound, grouped tabs when
 * "Include tabs in groups" is off, tabs on the "Never close tabs from these sites" list, and
 * incognito tabs (their addresses aren't kept for reopening). Chrome tells extensions nothing
 * about camera, microphone or screen capture (checked in Chromium 156: no tab field changes), so
 * a call's site belongs on the never-close list. Chrome's Memory Saver, which unloads tabs
 * without closing them, isn't reimplemented: the settings page links to it.
 *
 * Only time Chrome was running and the computer awake counts as unused. Chrome's
 * `tab.lastAccessed` is a wall-clock time, and a missed alarm fires once when the computer wakes
 * (or Chrome starts), so without this a night's sleep closed every tab at the first check of the
 * morning. Each check is a tick of the {@link AwakeClock}, kept in `chrome.storage.local` (it
 * must outlive Chrome being closed): a tick much later than the last one means the time between
 * was away time, and it's taken off every tab's idle time. Time before the setting was turned on
 * counts as away too (nothing was watching), so a tab closes once it has gone unused for the
 * chosen time of running, awake Chrome since then. No `idle` permission: it reports a locked
 * screen, not sleep, and nothing while Chrome is closed.
 *
 * @module background/auto-close
 */
import { unused } from '../shared/actions.js';
import { tabUrl } from '../shared/sites.js';
import { recordClosed } from '../shared/undo.js';
import { onSite, siteHost } from '../vendor/extension-kit/index.js';
import { keepAlarm } from './alarm.js';

/** @import { AlarmsApi } from './alarm.js' */
/** @import { Settings } from '../shared/settings.js' */
/** @import { Tab } from '../shared/sites.js' */
/** @import { StorageArea } from '../vendor/extension-kit/settings/storage.js' */

/** The alarm's name. */
export const AUTO_CLOSE_ALARM = 'close-unused-tabs';
/** How often the tabs are checked, in minutes. A test build makes it seconds. */
export const CHECK_MINUTES = 5;
/** One hour, the unit of `autoCloseHours`. A test build makes it a second. */
export const HOUR_MS = 60 * 60 * 1000;
/** The chrome.storage.local item holding the {@link AwakeClock}. */
export const AWAKE_KEY = 'awakeClock';
/** A check this much later than the last one means Chrome wasn't running, or the computer slept, in between: two periods. */
export const GAP_MS = 2 * CHECK_MINUTES * 60 * 1000;
/** The most away stretches kept (one a sleep or a restart): past it, everything before the oldest's end counts as away. */
export const MAX_AWAY = 200;

/**
 * What's known of when Chrome was running with the computer awake, while automatic closing is on.
 *
 * @typedef {object} AwakeClock
 * @property {number} since When watching began (the setting was turned on), in ms since the
 *   epoch: all time before it counts as away.
 * @property {number} tick The last check: Chrome was running and awake then.
 * @property {[number, number][]} away Stretches when it wasn't (asleep, or Chrome closed), as
 *   [from, to], oldest first.
 */

/**
 * The chrome APIs automatic closing uses, as the slices it calls.
 *
 * @typedef {object} AutoCloseApis
 * @property {{
 *   query(query: chrome.tabs.QueryInfo): Promise<Tab[]>,
 *   remove(tabIds: number[]): Promise<void>,
 * }} tabs `chrome.tabs`.
 * @property {StorageArea} session `chrome.storage.session`, for the closed batch.
 * @property {StorageArea} local `chrome.storage.local`, for the awake clock.
 */

/**
 * A clock that starts watching now.
 *
 * @param {number} now - The time, in ms since the epoch.
 * @returns {AwakeClock} The clock.
 */
export const startClock = (now) => ({ since: now, tick: now, away: [] });

/**
 * The clock after a check at `now`: if the last check was more than {@link GAP_MS} ago, the time
 * between is a new away stretch (all of it: at most one period of it was really awake, so tabs
 * are kept a little longer, never closed early).
 *
 * @param {AwakeClock} clock - The clock as stored.
 * @param {number} now - The time, in ms since the epoch.
 * @returns {AwakeClock} The new clock, to store.
 * @example
 * tickClock({ since: 0, tick: 1000, away: [] }, 1000 + 8 * HOUR_MS).away; // [[1000, 1000 + 8 * HOUR_MS]]
 */
export function tickClock(clock, now) {
  const away = now - clock.tick > GAP_MS ? [...clock.away, /** @type {[number, number]} */ ([clock.tick, now])] : [...clock.away];
  let { since } = clock;
  // Past the limit, the oldest stretch is folded into "before watching began": more away time, never less.
  while (away.length > MAX_AWAY) since = Math.max(since, /** @type {[number, number]} */ (away.shift())[1]);
  return { since, tick: now, away };
}

/**
 * How long Chrome was running and awake between `from` and `now`, as far as the clock knows.
 *
 * @param {AwakeClock} clock - The clock.
 * @param {number} from - A time, in ms since the epoch (a tab's `lastAccessed`).
 * @param {number} now - The time now.
 * @returns {number} The awake time, in ms: none from before watching began, none from away stretches.
 * @example
 * awakeTime({ since: 0, tick: 90, away: [[20, 80]] }, 10, 100); // 30
 */
export function awakeTime(clock, from, now) {
  const start = Math.max(from, clock.since);
  let awake = now - start;
  for (const [left, back] of clock.away) awake -= Math.max(0, Math.min(back, now) - Math.max(left, start));
  return Math.max(0, awake);
}

/**
 * Read the clock from storage.
 *
 * @param {StorageArea} local - `chrome.storage.local`.
 * @returns {Promise<AwakeClock | null>} The clock; null when there's none (or it isn't one).
 */
export async function loadClock(local) {
  const { [AWAKE_KEY]: clock } = await local.get([AWAKE_KEY]);
  const valid = clock && typeof clock.since === 'number' && typeof clock.tick === 'number' && Array.isArray(clock.away);
  return valid ? clock : null;
}

/**
 * The tabs automatic closing would close now.
 *
 * @param {readonly Tab[]} tabs - Every tab in a normal window.
 * @param {Settings} settings - The user's settings.
 * @param {number} now - The time, in ms since the epoch.
 * @param {AwakeClock} clock - When Chrome was running and awake.
 * @returns {Tab[]} The ones to close; none while the setting is off.
 */
export function unusedTabs(tabs, settings, now, clock) {
  if (!settings.autoClose) return [];
  const ageMs = settings.autoCloseHours * HOUR_MS;
  return tabs.filter((tab) =>
    !tab.incognito
    && unused(tab, settings, now, ageMs)
    && awakeTime(clock, tab.lastAccessed ?? now, now) >= ageMs
    && !onSite(siteHost(tabUrl(tab)), settings.keepSites));
}

/**
 * One check: tick the awake clock, then close the tabs that have gone unused for the chosen time
 * of running, awake Chrome, adding them to the "Reopen closed tabs" batch first.
 *
 * @param {AutoCloseApis} apis - `chrome.tabs`, `chrome.storage.session` and `chrome.storage.local`.
 * @param {Settings} settings - The user's settings.
 * @param {number} now - The time, in ms since the epoch.
 * @returns {Promise<number[]>} The ids of the tabs closed; none while the setting is off.
 */
export async function closeUnusedTabs({ tabs, session, local }, settings, now) {
  if (!settings.autoClose) return [];
  const stored = await loadClock(local);
  const clock = stored ? tickClock(stored, now) : startClock(now);
  await local.set({ [AWAKE_KEY]: clock });
  const chosen = unusedTabs(await tabs.query({ windowType: 'normal' }), settings, now, clock);
  const ids = chosen.flatMap((tab) => tab.id ?? []);
  if (!ids.length) return [];
  await recordClosed(session, chosen, { append: true });
  await tabs.remove(ids);
  return ids;
}

/**
 * Keep the alarm and the awake clock in step with the setting: checking every
 * {@link CHECK_MINUTES} while it's on, with a clock that starts when it's turned on; no alarm and
 * no clock while it's off. An alarm already running at that period is left alone, so a worker
 * waking up doesn't push the next check back, and a clock already kept is left running (an
 * update, a restart).
 *
 * @param {{alarms: AlarmsApi, local: StorageArea}} apis - `chrome.alarms` and `chrome.storage.local`.
 * @param {Settings} settings - The user's settings.
 * @param {number} now - The time, in ms since the epoch.
 * @returns {Promise<void>}
 */
export async function scheduleAutoClose({ alarms, local }, settings, now) {
  if (!settings.autoClose) {
    await Promise.all([keepAlarm(alarms, AUTO_CLOSE_ALARM, 0), local.remove(AWAKE_KEY)]);
    return;
  }
  if (!(await loadClock(local))) await local.set({ [AWAKE_KEY]: startClock(now) });
  await keepAlarm(alarms, AUTO_CLOSE_ALARM, CHECK_MINUTES);
}
