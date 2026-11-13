/**
 * Workspaces to and from a file, to keep a copy or move them to another computer (they're never
 * synced). The file is JSON: {@link FILE_APP}, {@link FILE_KIND}, {@link FILE_VERSION}, when it
 * was written, and the workspaces as they're stored, without their ids.
 *
 * Reading one never trusts it: it must say it's ours and not be from a newer version, and every
 * workspace in it goes through the same door as open windows do (`snapshotWindows`): tabs that
 * can't be reopened here are left out and counted, a password in an address is dropped, and the
 * size limits hold. A workspace already kept (same name, same windows) is skipped, so reading
 * the same file twice adds nothing; nothing kept is ever replaced.
 *
 * @module shared/transfer
 */
import { MAX_NAME_LENGTH, MAX_WORKSPACES, snapshotWindows, workspaceName } from './workspaces.js';

/** @import { OpenGroup, OpenWindow, Workspace, WorkspaceWindow } from './workspaces.js' */

/** What a file of ours says it's from. */
export const FILE_APP = 'better-tab-actions';
/** What a file of workspaces says it holds. */
export const FILE_KIND = 'workspaces';
/** The file format's version: a file with a higher one is refused. */
export const FILE_VERSION = 1;

/**
 * What a file would add, worked out before anything is stored.
 *
 * @typedef {object} ImportPreview
 * @property {Workspace[]} fresh The workspaces to add, with new ids.
 * @property {number} existing How many in the file are already kept (or twice in the file).
 * @property {number} skipped How many tabs in the file can't be reopened here, and so are left out.
 * @property {number} noRoom How many more would be new, but are over {@link MAX_WORKSPACES}.
 */

/**
 * Why a file can't be read: `notOurs` (not JSON, or not a workspaces file of this extension) or
 * `newer` (written by a later version).
 *
 * @typedef {'notOurs' | 'newer'} ImportProblem
 */

const STATES = new Set(['normal', 'maximized', 'minimized', 'fullscreen']);
const COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
/** A window's groups get ids from here up, so no two windows of a file share one. */
const GROUPS_PER_WINDOW = 100_000;

/**
 * The file for some workspaces.
 *
 * @param {readonly Workspace[]} workspaces - The workspaces.
 * @param {number} now - The time, in ms since the epoch.
 * @returns {{filename: string, text: string}} Its name ("better-tab-actions-workspaces-2026-11-13.json") and contents.
 */
export function workspacesFile(workspaces, now) {
  const file = {
    app: FILE_APP, kind: FILE_KIND, version: FILE_VERSION, exported: new Date(now).toISOString(),
    workspaces: workspaces.map(({ name, savedAt, skipped, windows }) => ({ name, savedAt, skipped, windows })),
  };
  return { filename: `${FILE_APP}-${FILE_KIND}-${file.exported.slice(0, 10)}.json`, text: `${JSON.stringify(file, null, 2)}\n` };
}

/**
 * @param {unknown} value - Anything.
 * @returns {Record<string, unknown>} It, if it's an object; else an empty one.
 */
const record = (value) => (value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {});
/**
 * @param {unknown} value - Anything.
 * @returns {unknown[]} It, if it's a list; else an empty one.
 */
const list = (value) => (Array.isArray(value) ? value : []);
/**
 * @param {unknown} value - Anything.
 * @returns {number | undefined} It, if it's a whole number.
 */
const whole = (value) => (Number.isSafeInteger(value) ? /** @type {number} */ (value) : undefined);

/**
 * A file's window as the open window it describes, so `snapshotWindows` can take it in like any
 * other: anything that isn't the right kind of value becomes an ordinary window's.
 *
 * @param {unknown} raw - A window from a file.
 * @param {number} index - Its place in its workspace.
 * @returns {{window: OpenWindow, groups: OpenGroup[]}} The window, and its groups.
 */
function asOpenWindow(raw, index) {
  const win = record(raw);
  const base = (index + 1) * GROUPS_PER_WINDOW;
  const groups = list(win.groups).map((group, g) => {
    const { title, color, collapsed } = record(group);
    return /** @type {OpenGroup} */ ({
      id: base + g, title: typeof title === 'string' ? title : '', color: COLORS.has(String(color)) ? color : 'grey', collapsed: collapsed === true,
    });
  });
  const tabs = list(win.tabs).map((tab, t) => {
    const { url, title, pinned, group } = record(tab);
    const g = whole(group);
    return {
      id: t, index: t, windowId: index, url: typeof url === 'string' ? url : '', title: typeof title === 'string' ? title : '',
      pinned: pinned === true, active: t === win.active, groupId: g !== undefined && groups[g] ? base + g : -1,
      highlighted: false, frozen: false, incognito: false, selected: false, discarded: false, autoDiscardable: true,
    };
  });
  /** @type {OpenWindow} */
  const window = { id: index, type: 'normal', incognito: false, state: /** @type {OpenWindow['state']} */ (STATES.has(String(win.state)) ? win.state : 'normal'), focused: win.focused === true, tabs };
  for (const key of /** @type {const} */ (['left', 'top', 'width', 'height'])) {
    const value = whole(win[key]);
    if (value !== undefined) window[key] = value;
  }
  return { window, groups };
}

/**
 * What makes two workspaces the same one: the name, and every window with its tabs, groups,
 * state and size.
 *
 * @param {Pick<Workspace, 'name' | 'windows'>} workspace - A workspace.
 * @returns {string} The same text for the same workspace, however its file ordered its fields.
 */
const sameKey = ({ name, windows }) => JSON.stringify([name, windows.map((win) => [
  win.state, win.left, win.top, win.width, win.height, Boolean(win.focused), win.active,
  win.tabs.map((tab) => [tab.url, tab.title, Boolean(tab.pinned), tab.group ?? -1]),
  win.groups.map((group) => [group.title, group.color, group.collapsed]),
])]);

/**
 * Read a workspaces file against what's kept.
 *
 * @param {string} text - The file's contents.
 * @param {object} context - What it's read against.
 * @param {readonly Workspace[]} context.kept - The workspaces already kept.
 * @param {boolean} context.fileAccess - Whether file:// pages can be reopened here.
 * @param {number} context.now - The time, for a workspace with no date of its own.
 * @param {string} [context.locale] - For the name of a workspace with none.
 * @returns {ImportPreview | {problem: ImportProblem}} What it would add, or why it can't be read.
 * @example
 * const read = readWorkspacesFile(await file.text(), { kept, fileAccess, now: Date.now() });
 * if (!('problem' in read)) await updateWorkspaces(local, (list) => [...read.fresh, ...list]);
 */
export function readWorkspacesFile(text, { kept, fileAccess, now, locale }) {
  /** @type {Record<string, unknown>} */
  let file;
  try {
    file = record(JSON.parse(text));
  } catch {
    return { problem: 'notOurs' };
  }
  const version = whole(file.version);
  if (file.app !== FILE_APP || file.kind !== FILE_KIND || version === undefined || version < 1 || !Array.isArray(file.workspaces)) return { problem: 'notOurs' };
  if (version > FILE_VERSION) return { problem: 'newer' };

  const seen = new Set(kept.map(sameKey));
  /** @type {ImportPreview} */
  const preview = { fresh: [], existing: 0, skipped: 0, noRoom: 0 };
  for (const raw of file.workspaces) {
    const { name, savedAt, skipped, windows: rawWindows } = record(raw);
    const open = list(rawWindows).map(asOpenWindow);
    /** @type {{windows: WorkspaceWindow[], skipped: number}} */
    const { windows, skipped: left } = snapshotWindows(open.map((o) => o.window), open.flatMap((o) => o.groups), fileAccess);
    preview.skipped += left;
    if (!windows.length) continue;
    const saved = whole(savedAt) ?? now;
    /** @type {Workspace} */
    const workspace = {
      id: crypto.randomUUID(),
      name: (typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '') || workspaceName(windows, saved, locale),
      savedAt: saved, skipped: Math.max(0, whole(skipped) ?? 0) + left, windows,
    };
    const key = sameKey(workspace);
    if (seen.has(key)) preview.existing++;
    else if (kept.length + preview.fresh.length >= MAX_WORKSPACES) preview.noRoom++;
    else preview.fresh.push(workspace);
    seen.add(key);
  }
  return preview;
}
