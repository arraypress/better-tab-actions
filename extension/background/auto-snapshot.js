/**
 * "Take snapshots automatically": while the setting is on, a `chrome.alarms` alarm takes a
 * snapshot of the open windows every `snapshotMinutes`, if their layout has changed
 * (shared/snapshots.js). Turning it on (or changing how often) takes one at once.
 *
 * An alarm missed while the computer slept, or Chrome was closed, fires once afterwards: one
 * snapshot, and only if something changed, so no awake clock is needed here (automatic closing
 * needs one because it measures how long tabs went unused).
 *
 * @module background/auto-snapshot
 */
import { takeSnapshot } from '../shared/snapshots.js';
import { keepAlarm } from './alarm.js';

/** @import { Settings } from '../shared/settings.js' */
/** @import { SnapshotResult } from '../shared/snapshots.js' */
/** @import { WorkspaceApis } from '../shared/workspaces.js' */
/** @import { AlarmsApi } from './alarm.js' */

/** The alarm's name. */
export const SNAPSHOT_ALARM = 'take-snapshot';

/**
 * Keep the alarm in step with the settings, and take a snapshot when it's newly set.
 *
 * @param {WorkspaceApis & {alarms: AlarmsApi}} apis - The chrome APIs, `chrome.alarms` among them.
 * @param {Settings} settings - The user's settings.
 * @param {number} now - The time, in ms since the epoch.
 * @returns {Promise<SnapshotResult | undefined>} How the snapshot went, if one was due.
 */
export async function scheduleSnapshots(apis, settings, now) {
  const started = await keepAlarm(apis.alarms, SNAPSHOT_ALARM, settings.autoSnapshot ? settings.snapshotMinutes : 0);
  return started ? takeSnapshot(apis, { auto: true, now }) : undefined;
}
