/**
 * Snapshots: copies of every normal window, kept so a session can be brought back after tabs
 * were lost. A snapshot holds what a workspace holds (workspaces.js: tabs in order, pinned tabs,
 * groups, window state and size) and no name: it's known by when it was taken. Incognito windows
 * are never in one.
 *
 * Two pools, each with its own limits, so one never pushes the other out:
 * - **automatic** ones, taken on an alarm while "Take snapshots automatically" is on, and only
 *   when the layout has changed since the last snapshot ({@link layoutKey}: not for a new title
 *   or another tab in front). The oldest are dropped to stay within {@link MAX_AUTO} and
 *   {@link AUTO_BYTES}, and further if Chrome's storage is fuller than that;
 * - **manual** ones ("Take snapshot"), kept until they're deleted: at {@link MAX_MANUAL} or
 *   {@link MANUAL_BYTES} no more are taken.
 *
 * They're browsing history, so they live in `chrome.storage.local` only, never synced. With the
 * workspaces' own bound (40 × 200 KB) both pools still fit local's 10 MB. A snapshot that can't
 * be kept is never dropped silently: {@link takeSnapshot} says so, and an automatic one leaves
 * {@link PROBLEM_KEY} in `chrome.storage.session` for the settings page to show.
 *
 * @module shared/snapshots
 */
import {
  captureWindows, jsonBytes, layoutKey, loadList, loadWorkspaces, MAX_WORKSPACES, sizeSummary, updateList, updateWorkspaces,
  workspaceName,
} from './workspaces.js';

/** @import { StorageArea } from '../vendor/extension-kit/settings/storage.js' */
/** @import { Words } from './text.js' */
/** @import { Workspace, WorkspaceApis, WorkspaceWindow } from './workspaces.js' */

/**
 * A snapshot.
 *
 * @typedef {object} Snapshot
 * @property {string} id A random id.
 * @property {boolean} auto Whether it was taken automatically (else by "Take snapshot").
 * @property {number} savedAt When it was taken, in ms since the epoch.
 * @property {number} skipped Tabs that weren't kept: addresses that can't be reopened, or over the size limits.
 * @property {WorkspaceWindow[]} windows The windows.
 */

/**
 * How taking a snapshot went: `kept`; `unchanged` (automatic: the layout is as in the last
 * snapshot); `nothing` (no window with a tab that can be reopened); `full` (manual: the manual
 * pool is at its limit); `failed` (Chrome's storage refused it, whatever was dropped).
 *
 * @typedef {'kept' | 'unchanged' | 'nothing' | 'full' | 'failed'} SnapshotResult
 */

/** The chrome.storage.local item holding the snapshots, newest first. */
export const SNAPSHOTS_KEY = 'snapshots';
/** The chrome.storage.session item left (true) when an automatic snapshot couldn't be kept; gone once one is. */
export const PROBLEM_KEY = 'snapshotProblem';
/** The most automatic snapshots kept. */
export const MAX_AUTO = 20;
/** The most bytes (as stored, JSON) the automatic snapshots take together. */
export const AUTO_BYTES = 1024 * 1024;
/** The most manual snapshots kept. */
export const MAX_MANUAL = 10;
/** The most bytes the manual snapshots take together. */
export const MANUAL_BYTES = 512 * 1024;

/**
 * The snapshots.
 *
 * @param {StorageArea} local - `chrome.storage.local`.
 * @returns {Promise<Snapshot[]>} Newest first; [] when there are none.
 */
export const loadSnapshots = (local) => loadList(local, SNAPSHOTS_KEY);

/**
 * Change the snapshots: `change` gets the stored list and returns the new one.
 *
 * @param {StorageArea} local - `chrome.storage.local`.
 * @param {(list: Snapshot[]) => Snapshot[]} change - The change.
 * @returns {Promise<Snapshot[]>} The list as stored, newest first.
 * @example
 * await updateSnapshots(chrome.storage.local, (list) => list.filter((s) => s.id !== id)); // delete one
 */
export const updateSnapshots = (local, change) => updateList(local, SNAPSHOTS_KEY, change);

/**
 * How a snapshot's row describes it, under the time it was taken.
 *
 * @param {Snapshot} snapshot - The snapshot.
 * @param {Words} words - The extension's words.
 * @returns {string} "2 windows · 24 tabs · Automatic" (or "Taken by you").
 */
export const snapshotSummary = ({ windows, auto }, words) =>
  [...sizeSummary(windows, words), auto ? words.t('snapshotAutomatic') : words.t('snapshotManual')].join(' · ');

/**
 * Whether one more manual snapshot can be taken: the manual pool is under {@link MAX_MANUAL}.
 *
 * @param {readonly Snapshot[]} list - The snapshots.
 * @returns {boolean} True while there's room by count.
 */
export const roomForManual = (list) => list.filter((snapshot) => !snapshot.auto).length < MAX_MANUAL;

/**
 * The list with a new automatic snapshot, and the oldest automatic ones dropped until they're
 * within {@link MAX_AUTO} and {@link AUTO_BYTES} (the new one always stays). Manual ones are
 * never dropped.
 *
 * @param {readonly Snapshot[]} list - The snapshots, newest first.
 * @param {Snapshot} added - The new automatic snapshot.
 * @param {number} [drop] - How many more of the oldest automatic ones to drop (storage refused the last try). Default 0.
 * @returns {{list: Snapshot[], autos: number}} The new list, and how many automatic ones it holds.
 */
export function withAutomatic(list, added, drop = 0) {
  const autos = [added, ...list.filter((snapshot) => snapshot.auto)];
  let bytes = autos.reduce((sum, snapshot) => sum + jsonBytes(snapshot), 0);
  while (autos.length > 1 && (autos.length > MAX_AUTO || bytes > AUTO_BYTES)) bytes -= jsonBytes(autos.pop());
  autos.length = Math.max(1, autos.length - drop);
  return { list: [...autos, ...list.filter((snapshot) => !snapshot.auto)], autos: autos.length };
}

/**
 * Take a snapshot of every normal window.
 *
 * @param {WorkspaceApis} apis - The chrome APIs.
 * @param {object} options - Which kind, and when.
 * @param {boolean} options.auto - An automatic one: skipped when the layout is as in the last
 *   snapshot, and the oldest automatic ones make room for it. Else a manual one.
 * @param {number} options.now - The time, in ms since the epoch.
 * @param {number} [options.leaveOut] - A tab to leave out (the settings page that asked).
 * @returns {Promise<SnapshotResult>} How it went.
 */
export async function takeSnapshot(apis, { auto, now, leaveOut }) {
  const { windows, skipped } = await captureWindows(apis, { leaveOut });
  if (!windows.length) return 'nothing';
  const list = await loadSnapshots(apis.local);
  if (auto && list[0] && layoutKey(list[0].windows) === layoutKey(windows)) return 'unchanged';
  /** @type {Snapshot} */
  const snapshot = { id: crypto.randomUUID(), auto, savedAt: now, skipped, windows };

  if (!auto) {
    const manual = list.filter((other) => !other.auto);
    if (!roomForManual(list) || manual.reduce((sum, other) => sum + jsonBytes(other), jsonBytes(snapshot)) > MANUAL_BYTES) return 'full';
    return updateSnapshots(apis.local, (stored) => [snapshot, ...stored]).then(() => 'kept', () => 'failed');
  }
  // Storage fuller than the pool allows for (other items, a full manual pool): older automatic
  // ones go, one more each try, until the new one fits or it's the only one left.
  for (let drop = 0; ; drop++) {
    let autos = 0;
    try {
      await updateSnapshots(apis.local, (stored) => {
        const next = withAutomatic(stored, snapshot, drop);
        autos = next.autos;
        return next.list;
      });
      await apis.session.remove(PROBLEM_KEY);
      return 'kept';
    } catch {
      if (autos > 1) continue;
      await apis.session.set({ [PROBLEM_KEY]: true });
      return 'failed';
    }
  }
}

/**
 * Save a snapshot as a workspace, named after its main sites (else the day it was taken). The
 * snapshot stays.
 *
 * @param {StorageArea} local - `chrome.storage.local`.
 * @param {string} id - The snapshot.
 * @param {{now: number, locale?: string}} options - The time, and the locale for the name.
 * @returns {Promise<Workspace | null>} The new workspace; null when the snapshot is gone or
 *   {@link MAX_WORKSPACES} are kept.
 */
export async function saveSnapshotAsWorkspace(local, id, { now, locale }) {
  const snapshot = (await loadSnapshots(local)).find((other) => other.id === id);
  if (!snapshot || (await loadWorkspaces(local)).length >= MAX_WORKSPACES) return null;
  /** @type {Workspace} */
  const workspace = {
    id: crypto.randomUUID(), name: workspaceName(snapshot.windows, snapshot.savedAt, locale), savedAt: now,
    skipped: snapshot.skipped, windows: snapshot.windows,
  };
  await updateWorkspaces(local, (list) => [workspace, ...list]);
  return workspace;
}
