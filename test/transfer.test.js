/**
 * Workspaces to a file and back (extension/shared/transfer.js): what the file holds, that
 * reading it back adds nothing twice, and that a file is never trusted: every tab through the
 * same checks as an open one, junk left out and counted, other files and newer versions refused.
 *
 * @module test/transfer
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_APP, FILE_KIND, FILE_VERSION, readWorkspacesFile, workspacesFile } from '../extension/shared/transfer.js';
import { loadWorkspaces, MAX_TABS, MAX_TITLE, MAX_WORKSPACES } from '../extension/shared/workspaces.js';
import { fakeBrowser, runOn } from './fake-browser.js';

/** @import { Workspace } from '../extension/shared/workspaces.js' */

const NOW = Date.UTC(2026, 10, 13, 12);

/**
 * Two workspaces saved from real (fake-browser) windows: one with a pinned tab, a group, a
 * maximized window and a tab that can't be reopened; one plain.
 *
 * @returns {Promise<Workspace[]>} Them, most recent first.
 */
async function saved() {
  const b = fakeBrowser([
    { id: 1, url: 'https://mail.com/', title: 'Inbox', pinned: true },
    { id: 2, url: 'https://github.com/a', title: 'A', active: true },
    { id: 3, url: 'https://github.com/b', title: 'B' },
    { id: 4, url: 'chrome://crash/' },
    { id: 5, url: 'https://docs.com/', windowId: 2, active: true },
  ], { windows: { 1: { left: 5, top: 6, width: 1000, height: 700, focused: true }, 2: { state: 'maximized' } } });
  const groupId = await b.tabs.group({ tabIds: [2, 3], createProperties: { windowId: 1 } });
  await b.tabGroups.update(groupId, { title: 'Work', color: 'red', collapsed: true });
  await runOn(b, 'save-workspace', 2, { now: NOW, locale: 'en-GB' });
  await runOn(b, 'save-window-workspace', 5, { now: NOW + 1000, locale: 'en-GB' });
  return loadWorkspaces(b.local);
}

/**
 * Read a file with nothing kept (unless given), file access off.
 *
 * @param {unknown} file - The file's JSON, or its text.
 * @param {readonly Workspace[]} [kept] - What's already kept.
 */
const read = (file, kept = []) => {
  const result = readWorkspacesFile(typeof file === 'string' ? file : JSON.stringify(file), { kept, fileAccess: false, now: NOW, locale: 'en-GB' });
  if ('problem' in result) throw new Error(`refused: ${result.problem}`);
  return result;
};
/** @param {unknown[]} workspaces - A file's workspaces. */
const ours = (workspaces) => ({ app: FILE_APP, kind: FILE_KIND, version: FILE_VERSION, workspaces });

test('the file: named with the day, saying what it is and its version, holding the workspaces without their ids', async () => {
  const workspaces = await saved();
  const { filename, text } = workspacesFile(workspaces, NOW);
  assert.equal(filename, 'better-tab-actions-workspaces-2026-11-13.json');
  const file = JSON.parse(text);
  assert.deepEqual(Object.keys(file), ['app', 'kind', 'version', 'exported', 'workspaces']);
  assert.deepEqual([file.app, file.kind, file.version, file.exported], ['better-tab-actions', 'workspaces', 1, '2026-11-13T12:00:00.000Z']);
  assert.deepEqual(file.workspaces, workspaces.map(({ name, savedAt, skipped, windows }) => ({ name, savedAt, skipped, windows })));
  assert.ok(!text.includes(workspaces[0].id));
});

test('read back on another computer: the same workspaces, with new ids; read again: nothing new', async () => {
  const workspaces = await saved();
  const { text } = workspacesFile(workspaces, NOW);
  const first = read(text);
  assert.deepEqual({ existing: first.existing, skipped: first.skipped, noRoom: first.noRoom }, { existing: 0, skipped: 0, noRoom: 0 });
  assert.deepEqual(first.fresh.map((w) => ({ ...w, id: '' })), workspaces.map((w) => ({ ...w, id: '' })));
  assert.ok(first.fresh.every((w) => !workspaces.some((old) => old.id === w.id)));

  const again = read(text, first.fresh);
  assert.deepEqual({ fresh: again.fresh.length, existing: again.existing }, { fresh: 0, existing: 2 });
  // On the computer it came from, too; and a renamed one counts as new (nothing is overwritten).
  assert.equal(read(text, workspaces).fresh.length, 0);
  const renamed = read(text, [{ ...workspaces[0], name: 'Renamed' }, workspaces[1]]);
  assert.deepEqual(renamed.fresh.map((w) => w.name), [workspaces[0].name]);
  // The same workspace twice in one file is added once.
  const twice = JSON.parse(text);
  twice.workspaces.push(twice.workspaces[0]);
  assert.deepEqual({ fresh: read(twice).fresh.length, existing: read(twice).existing }, { fresh: 2, existing: 1 });
});

test('not ours, or from a newer version: refused whole, with which', () => {
  /** @param {string} text */
  const problem = (text) => {
    const result = readWorkspacesFile(text, { kept: [], fileAccess: false, now: NOW });
    return 'problem' in result ? result.problem : 'read';
  };
  assert.equal(problem('not json'), 'notOurs');
  assert.equal(problem('[]'), 'notOurs');
  assert.equal(problem('null'), 'notOurs');
  assert.equal(problem(JSON.stringify({ workspaces: [] })), 'notOurs');
  assert.equal(problem(JSON.stringify({ ...ours([]), app: 'another-extension' })), 'notOurs');
  assert.equal(problem(JSON.stringify({ ...ours([]), kind: 'settings' })), 'notOurs');
  assert.equal(problem(JSON.stringify({ ...ours([]), version: '1' })), 'notOurs');
  assert.equal(problem(JSON.stringify({ ...ours([]), workspaces: {} })), 'notOurs');
  assert.equal(problem(JSON.stringify({ ...ours([]), version: FILE_VERSION + 1 })), 'newer');
  assert.equal(problem(JSON.stringify(ours([]))), 'read');
});

test('a file is never trusted: bad tabs are left out and counted, passwords dropped, limits kept, junk made ordinary; one bad tab never refuses the file', () => {
  const { fresh, skipped } = read(ours([
    {
      name: '  Mixed  ', savedAt: NOW - 5000, skipped: 2,
      windows: [{
        state: 'sideways', left: 'x', width: 900, active: 2, focused: 'yes',
        groups: [{ title: 'G', color: 'ultraviolet', collapsed: 'no' }, 'junk'],
        tabs: [
          { url: 'javascript:alert(1)', title: 'x' },
          { url: 'https://me:secret@a.com/', title: 'T'.repeat(MAX_TITLE + 9), pinned: true },
          { url: 'https://b.com/', group: 0 },
          { url: 'file:///etc/passwd' },
          { url: 'chrome://crash/' },
          { url: 42 },
          'junk',
          { url: 'https://c.com/', group: 7, pinned: 'yes' },
        ],
      }],
    },
    { name: 'All bad', windows: [{ tabs: [{ url: 'javascript:void(0)' }] }] },
    { windows: [{ tabs: [{ url: 'https://github.com/x' }] }, 'junk', { tabs: 'junk' }] },
    'junk',
    { name: 'Many', windows: [{ tabs: Array.from({ length: MAX_TABS + 4 }, (_, i) => ({ url: `https://m.com/${i}` })) }] },
  ]));
  assert.deepEqual(fresh.map((w) => w.name), ['Mixed', 'github.com', 'Many']);
  const [mixed, unnamed, many] = fresh;
  assert.deepEqual(mixed.windows, [{
    state: 'normal', width: 900, active: 1, groups: [{ title: 'G', color: 'grey', collapsed: false }],
    tabs: [
      { url: 'https://a.com/', title: 'T'.repeat(MAX_TITLE), pinned: true },
      { url: 'https://b.com/', title: '', group: 0 },
      { url: 'https://c.com/', title: '' },
    ],
  }]);
  assert.deepEqual([mixed.savedAt, mixed.skipped], [NOW - 5000, 2 + 5]);
  assert.equal(unnamed.savedAt, NOW);
  assert.equal(many.windows[0].tabs.length, MAX_TABS);
  assert.equal(skipped, 5 + 1 + 4, 'five in Mixed, the only tab of All bad, four over the limit in Many');
  assert.ok(!JSON.stringify(fresh).includes('secret'));
});

test('never over the limit: only as many as there’s room for are new, the rest counted', async () => {
  const [one] = await saved();
  const kept = Array.from({ length: MAX_WORKSPACES - 1 }, (_, i) => ({ ...one, id: `k${i}`, name: `Kept ${i}` }));
  const result = read(ours([{ ...one, name: 'First' }, { ...one, name: 'Second' }, { ...one, name: 'Third' }, { ...one, name: 'Kept 3' }]), kept);
  assert.deepEqual({ fresh: result.fresh.map((w) => w.name), noRoom: result.noRoom, existing: result.existing }, { fresh: ['First'], noRoom: 2, existing: 1 });
});
