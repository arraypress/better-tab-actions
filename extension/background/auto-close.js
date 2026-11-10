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
 * @module background/auto-close
 */
import { unused } from '../shared/actions.js';
import { tabUrl } from '../shared/sites.js';
import { recordClosed } from '../shared/undo.js';
import { onSite, siteHost } from '../vendor/extension-kit/index.js';

/** @import { Settings } from '../shared/settings.js' */
/** @import { Tab } from '../shared/sites.js' */
/** @import { StorageArea } from '../vendor/extension-kit/settings/storage.js' */

/** The alarm's name. */
export const AUTO_CLOSE_ALARM = 'close-unused-tabs';
/** How often the tabs are checked, in minutes. A test build makes it seconds. */
export const CHECK_MINUTES = 5;
/** One hour, the unit of `autoCloseHours`. A test build makes it a second. */
export const HOUR_MS = 60 * 60 * 1000;

/**
 * The chrome APIs automatic closing uses, as the slices it calls.
 *
 * @typedef {object} AutoCloseApis
 * @property {{
 *   query(query: chrome.tabs.QueryInfo): Promise<Tab[]>,
 *   remove(tabIds: number[]): Promise<void>,
 * }} tabs `chrome.tabs`.
 * @property {StorageArea} session `chrome.storage.session`, for the closed batch.
 */

/**
 * The chrome.alarms slice the schedule uses.
 *
 * @typedef {{
 *   get(name: string): Promise<chrome.alarms.Alarm | undefined>,
 *   create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void>,
 *   clear(name: string): Promise<boolean>,
 * }} AlarmsApi
 */

/**
 * The tabs automatic closing would close now.
 *
 * @param {readonly Tab[]} tabs - Every tab in a normal window.
 * @param {Settings} settings - The user's settings.
 * @param {number} now - The time, in ms since the epoch.
 * @returns {Tab[]} The ones to close; none while the setting is off.
 */
export function unusedTabs(tabs, settings, now) {
  if (!settings.autoClose) return [];
  const ageMs = settings.autoCloseHours * HOUR_MS;
  return tabs.filter((tab) =>
    !tab.incognito && unused(tab, settings, now, ageMs) && !onSite(siteHost(tabUrl(tab)), settings.keepSites));
}

/**
 * Close the unused tabs, adding them to the "Reopen closed tabs" batch first.
 *
 * @param {AutoCloseApis} apis - `chrome.tabs` and `chrome.storage.session`.
 * @param {Settings} settings - The user's settings.
 * @param {number} now - The time, in ms since the epoch.
 * @returns {Promise<number[]>} The ids of the tabs closed.
 */
export async function closeUnusedTabs({ tabs, session }, settings, now) {
  const chosen = unusedTabs(await tabs.query({ windowType: 'normal' }), settings, now);
  const ids = chosen.flatMap((tab) => tab.id ?? []);
  if (!ids.length) return [];
  await recordClosed(session, chosen, now, { append: true });
  await tabs.remove(ids);
  return ids;
}

/**
 * Keep the alarm in step with the setting: checking every {@link CHECK_MINUTES} while it's on,
 * none while it's off. An alarm already running at that period is left alone, so a worker
 * waking up doesn't push the next check back.
 *
 * @param {AlarmsApi} alarms - `chrome.alarms`.
 * @param {Settings} settings - The user's settings.
 * @returns {Promise<void>}
 */
export async function scheduleAutoClose(alarms, settings) {
  if (!settings.autoClose) {
    await alarms.clear(AUTO_CLOSE_ALARM);
    return;
  }
  if ((await alarms.get(AUTO_CLOSE_ALARM))?.periodInMinutes === CHECK_MINUTES) return;
  await alarms.create(AUTO_CLOSE_ALARM, { delayInMinutes: CHECK_MINUTES, periodInMinutes: CHECK_MINUTES });
}
