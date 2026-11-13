/**
 * Snapshots: when one is taken and when it isn't, what it keeps, the two pools and their limits,
 * what happens when Chrome's storage is full, and saving one as a workspace: against the
 * in-memory browser, whose storage refuses what Chrome's refuses (10 MB).
 *
 * @module test/snapshots
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_QUOTA_BYTES } from '@arraypress/extension-kit/testing';
import {
  AUTO_BYTES, loadSnapshots, MANUAL_BYTES, MAX_AUTO, MAX_MANUAL, PROBLEM_KEY, saveSnapshotAsWorkspace, snapshotSummary, takeSnapshot,
  updateSnapshots,
} from '../extension/shared/snapshots.js';
import { dateTime, minutesText } from '../extension/shared/text.js';
import { loadWorkspaces, MAX_BYTES, MAX_WORKSPACES, openWorkspace, updateWorkspaces } from '../extension/shared/workspaces.js';
import { fakeBrowser } from './fake-browser.js';
import { WORDS } from './helpers.js';

const NOW = Date.UTC(2026, 10, 13, 21, 54);
const MINUTE = 60_000;

/** A window with a pinned tab and a red group, a second, maximized one, and an incognito one. */
async function browser() {
  const b = fakeBrowser([
    { id: 1, url: 'https://mail.com/', title: 'Inbox', pinned: true },
    { id: 2, url: 'https://github.com/a', active: true },
    { id: 3, url: 'https://github.com/b' },
    { id: 4, url: 'chrome://crash/' },
    { id: 5, url: 'https://docs.com/', windowId: 2, active: true },
    { id: 6, url: 'https://secret.com/', windowId: 3, incognito: true, active: true },
  ], { windows: { 1: { left: 5, top: 6, width: 1000, height: 700 }, 2: { state: 'maximized' } } });
  const groupId = await b.tabs.group({ tabIds: [2, 3], createProperties: { windowId: 1 } });
  await b.tabGroups.update(groupId, { title: 'Work', color: 'red' });
  return b;
}

/**
 * The snapshots as "auto@minutes" or "manual@minutes" (minutes after NOW), newest first.
 *
 * @param {ReturnType<typeof fakeBrowser>} b - The browser.
 */
const kinds = async (b) => (await loadSnapshots(b.local)).map((s) => `${s.auto ? 'auto' : 'manual'}@${(s.savedAt - NOW) / MINUTE}`);

test('a snapshot keeps what a workspace keeps (order, pinned, groups, window state and size), counts what can’t be reopened, and never an incognito window', async () => {
  const b = await browser();
  assert.equal(await takeSnapshot(b, { auto: false, now: NOW }), 'kept');
  const [snapshot] = await loadSnapshots(b.local);
  assert.deepEqual({ auto: snapshot.auto, savedAt: snapshot.savedAt, skipped: snapshot.skipped }, { auto: false, savedAt: NOW, skipped: 1 });
  assert.deepEqual(snapshot.windows, [
    {
      state: 'normal', left: 5, top: 6, width: 1000, height: 700, active: 1, groups: [{ title: 'Work', color: 'red', collapsed: false }],
      tabs: [{ url: 'https://mail.com/', title: 'Inbox', pinned: true }, { url: 'https://github.com/a', title: '', group: 0 }, { url: 'https://github.com/b', title: '', group: 0 }],
    },
    { state: 'maximized', active: 0, groups: [], tabs: [{ url: 'https://docs.com/', title: '' }] },
  ]);
  assert.ok(!JSON.stringify(await b.local.get(null)).includes('secret.com'));
  assert.equal(snapshotSummary(snapshot, WORDS), '2 windows · 4 tabs · Taken by you');
  assert.equal(snapshotSummary({ ...snapshot, auto: true, windows: [snapshot.windows[1]] }, WORDS), '1 window · 1 tab · Automatic');
  assert.equal(dateTime(NOW, 'en-GB'), new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(NOW));
  assert.deepEqual([5, 60].map((minutes) => minutesText(minutes, WORDS)), ['5 minutes', '1 hour']);

  // It opens like a workspace: the same windows back.
  for (const id of [1, 2, 3]) await b.windows.remove(id);
  await openWorkspace(b, snapshot, { reopenGroups: true });
  const [w1, w2] = b.windowIds;
  assert.deepEqual(b.described(w1), ['https://mail.com/ pinned discarded', 'https://github.com/a [Work]', 'https://github.com/b discarded [Work]']);
  assert.equal(b.window(w2)?.state, 'maximized');
});

test('an automatic snapshot is taken only when the layout has changed: not for a new title or another tab in front', async () => {
  const b = await browser();
  const auto = (/** @type {number} */ minutes) => takeSnapshot(b, { auto: true, now: NOW + minutes * MINUTE });
  assert.equal(await auto(0), 'kept');
  assert.equal(await auto(15), 'unchanged');
  b.setTitle(1, '(3) Inbox');
  await b.tabs.update(3, { active: true });
  await b.windows.update(2, { state: 'normal' });
  assert.equal(await auto(30), 'unchanged', 'a title, the tab in front and a window’s state aren’t changes worth a snapshot');
  await b.tabs.create({ windowId: 1, url: 'https://new.com/' });
  assert.equal(await auto(45), 'kept', 'a tab was opened');
  await b.tabs.update(3, { pinned: true });
  assert.equal(await auto(60), 'kept', 'a tab was pinned');
  await b.tabs.remove([5]);
  assert.equal(await auto(75), 'kept', 'a window closed');
  assert.deepEqual(await kinds(b), ['auto@75', 'auto@60', 'auto@45', 'auto@0']);
  // A manual one is taken whatever has or hasn't changed, and the next automatic one compares with it.
  assert.equal(await takeSnapshot(b, { auto: false, now: NOW + 80 * MINUTE }), 'kept');
  assert.equal(await auto(90), 'unchanged');
});

test('nothing to keep: no snapshot, and it says so', async () => {
  const b = fakeBrowser([{ id: 1, url: 'chrome://crash/', active: true }, { id: 2, url: 'https://x.com/', windowId: 2, incognito: true }]);
  assert.equal(await takeSnapshot(b, { auto: false, now: NOW }), 'nothing');
  assert.equal(await takeSnapshot(b, { auto: true, now: NOW }), 'nothing');
  assert.deepEqual(await loadSnapshots(b.local), []);
});

test('two pools: automatic snapshots drop their own oldest and never a manual one; manual ones stop at their limit and say so', async () => {
  const b = fakeBrowser([{ id: 1, url: 'https://a.com/', active: true }]);
  assert.equal(await takeSnapshot(b, { auto: false, now: NOW - MINUTE }), 'kept');
  for (let i = 0; i < MAX_AUTO + 5; i++) {
    await b.tabs.create({ windowId: 1, url: `https://a.com/${i}` });
    assert.equal(await takeSnapshot(b, { auto: true, now: NOW + i * MINUTE }), 'kept');
  }
  const list = await kinds(b);
  assert.equal(list.filter((kind) => kind.startsWith('auto')).length, MAX_AUTO);
  assert.equal(list[0], `auto@${MAX_AUTO + 4}`, 'the newest is kept');
  assert.equal(list.at(-2), 'auto@5', 'the five oldest automatic ones went');
  assert.equal(list.at(-1), 'manual@-1', 'the manual one, older than them all, is still there');

  for (let i = 1; i < MAX_MANUAL; i++) assert.equal(await takeSnapshot(b, { auto: false, now: NOW + (100 + i) * MINUTE }), 'kept');
  assert.equal(await takeSnapshot(b, { auto: false, now: NOW + 200 * MINUTE }), 'full');
  assert.equal((await kinds(b)).filter((kind) => kind.startsWith('manual')).length, MAX_MANUAL);
  assert.equal((await kinds(b)).filter((kind) => kind.startsWith('auto')).length, MAX_AUTO, 'manual ones pushed no automatic one out either');
});

test('capped by bytes too: big automatic snapshots keep within their megabyte, big manual ones within theirs', async () => {
  // 400 tabs with long addresses: a snapshot near a workspace's 200 KB.
  const big = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, url: `https://a.com/${i}?${'x'.repeat(430)}`, active: i === 0 }));
  const b = fakeBrowser(big);
  const bytes = (/** @type {boolean} */ auto) => loadSnapshots(b.local).then((list) => new TextEncoder().encode(JSON.stringify(list.filter((s) => s.auto === auto))).length);
  for (let i = 0; i < 9; i++) {
    await b.tabs.create({ windowId: 1, url: `https://b.com/${i}` });
    assert.equal(await takeSnapshot(b, { auto: true, now: NOW + i * MINUTE }), 'kept');
  }
  const autos = (await kinds(b)).length;
  assert.ok(autos >= 4 && autos < 9, `${autos} kept`);
  assert.ok(await bytes(true) <= AUTO_BYTES + 100, `${await bytes(true)} bytes`);
  assert.equal((await kinds(b))[0], 'auto@8');

  /** @type {string[]} */
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await takeSnapshot(b, { auto: false, now: NOW + (20 + i) * MINUTE }));
  assert.deepEqual([...new Set(results)], ['kept', 'full']);
  assert.ok(await bytes(false) <= MANUAL_BYTES + 100);
  assert.ok(MAX_WORKSPACES * (MAX_BYTES + 1024) + AUTO_BYTES + MANUAL_BYTES + 100 * 1024 < LOCAL_QUOTA_BYTES, 'workspaces and both pools at their limits fit Chrome’s 10 MB');
});

test('Chrome’s storage full: older automatic snapshots make room; when even that isn’t enough it fails out loud, and clears once one is kept', async () => {
  const b = fakeBrowser([{ id: 1, url: `https://a.com/?${'x'.repeat(4000)}`, active: true }]);
  for (let i = 0; i < 6; i++) {
    await b.tabs.create({ windowId: 1, url: `https://a.com/${i}?${'y'.repeat(4000)}` });
    await takeSnapshot(b, { auto: true, now: NOW + i * MINUTE });
  }
  await takeSnapshot(b, { auto: false, now: NOW + 6 * MINUTE });
  // Something else fills the storage, leaving room for less than the six are taking.
  const used = new TextEncoder().encode(JSON.stringify(await b.local.get(null))).length;
  const filler = (/** @type {number} */ spare) => b.local.set({ filler: 'z'.repeat(LOCAL_QUOTA_BYTES - used - 200 + spare) });
  await filler(0);
  await b.tabs.create({ windowId: 1, url: `https://a.com/new?${'y'.repeat(4000)}` });
  assert.equal(await takeSnapshot(b, { auto: true, now: NOW + 10 * MINUTE }), 'kept');
  const after = await kinds(b);
  assert.equal(after[0], 'auto@10');
  assert.ok(after.filter((kind) => kind.startsWith('auto')).length < 7, `older automatic ones went: ${after}`);
  assert.ok(after.includes('manual@6'), 'the manual one stayed');
  assert.deepEqual(await b.session.get(PROBLEM_KEY), {});

  // No room even for one.
  await updateSnapshots(b.local, () => []);
  await b.local.set({ filler: 'z'.repeat(LOCAL_QUOTA_BYTES - 2000) });
  assert.equal(await takeSnapshot(b, { auto: true, now: NOW + 20 * MINUTE }), 'failed');
  assert.deepEqual(await b.session.get(PROBLEM_KEY), { [PROBLEM_KEY]: true });
  assert.equal(await takeSnapshot(b, { auto: false, now: NOW + 21 * MINUTE }), 'failed');
  assert.deepEqual(await loadSnapshots(b.local), [], 'nothing half-written');
  await b.local.remove('filler');
  assert.equal(await takeSnapshot(b, { auto: true, now: NOW + 30 * MINUTE }), 'kept');
  assert.deepEqual(await b.session.get(PROBLEM_KEY), {});
});

test('“Save as workspace”: a workspace named after the snapshot’s main sites, the snapshot kept; nothing once the workspaces are full', async () => {
  const b = await browser();
  await takeSnapshot(b, { auto: true, now: NOW });
  const [snapshot] = await loadSnapshots(b.local);
  const workspace = await saveSnapshotAsWorkspace(b.local, snapshot.id, { now: NOW + MINUTE, locale: 'en-GB' });
  assert.deepEqual(workspace && { name: workspace.name, savedAt: workspace.savedAt, skipped: workspace.skipped }, { name: 'github.com and docs.com', savedAt: NOW + MINUTE, skipped: 1 });
  assert.deepEqual((await loadWorkspaces(b.local))[0].windows, snapshot.windows);
  assert.equal((await loadSnapshots(b.local)).length, 1);
  assert.equal(await saveSnapshotAsWorkspace(b.local, 'gone', { now: NOW }), null);

  await updateWorkspaces(b.local, (list) => Array.from({ length: MAX_WORKSPACES }, (_, i) => ({ ...list[0], id: `w${i}`, windows: [] })));
  assert.equal(await saveSnapshotAsWorkspace(b.local, snapshot.id, { now: NOW }), null);
});
