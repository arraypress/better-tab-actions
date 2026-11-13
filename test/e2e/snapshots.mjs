/**
 * Real-browser check of what's kept beside workspaces: the test build in Playwright's Chromium,
 * its real settings page, real windows of the made-up sites.
 *
 *   npm run e2e
 *
 * 1. Export downloads one file (through a link: no permission), and Import reads it back: it
 *    says what it would add and adds it once confirmed; the same file again adds nothing; a file
 *    that isn't ours is refused.
 * 2. "Open in this window" opens a workspace's tabs in the settings page's window, groups kept.
 * 3. Snapshots: "Take snapshot" lists one under its time; with "Take snapshots automatically"
 *    on, the alarm is set and one is taken, the next alarm takes another only once a tab has
 *    been opened (not for a new title); "Save as workspace" and "Open" work on a row.
 * 4. None of it needs a permission: Chrome's install warnings are the same two.
 *
 * @module test/e2e/snapshots
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRunner, installWarnings, runChecks, until } from '@arraypress/extension-kit/testing';
import { click, EXTENSION, openWindow, testProfile } from './helpers.mjs';

/** @import { Snapshot } from '../../extension/shared/snapshots.js' */
/** @import { Workspace } from '../../extension/shared/workspaces.js' */

const profile = await testProfile('bta-snapshots-');
const launched = await profile.launch();
const { context, worker, url, close } = launched;
const runner = checkRunner();
const { check, fail } = runner;

const MAIL = 'https://mail.example/';
const GITHUB_A = 'https://github.example/a';
const GITHUB_B = 'https://github.example/b';
const DOCS = 'https://docs.example/';

/** The saved workspaces, as stored. */
const workspaces = () => worker.evaluate(async () => /** @type {Workspace[]} */ ((await chrome.storage.local.get('workspaces')).workspaces ?? []));
/** The snapshots, as stored. */
const snapshots = () => worker.evaluate(async () => /** @type {Snapshot[]} */ ((await chrome.storage.local.get('snapshots')).snapshots ?? []));
/**
 * A window's tabs as "url", with " pinned" and " [group title]" when they apply.
 *
 * @param {number} windowId - The window.
 */
const strip = (windowId) => worker.evaluate(async (windowId) => {
  const groups = new Map((await chrome.tabGroups.query({ windowId })).map((g) => [g.id, g.title]));
  return (await chrome.tabs.query({ windowId })).map((tab) => `${tab.url || tab.pendingUrl}${tab.pinned ? ' pinned' : ''}${groups.has(tab.groupId) ? ` [${groups.get(tab.groupId)}]` : ''}`);
}, windowId);
/** Have the snapshot alarm go off now, as Chrome does when it's due. */
const alarmNow = () => worker.evaluate(() => chrome.alarms.create('take-snapshot', { when: Date.now() + 50 }));

await runChecks(runner, async () => {
  // Two windows: a pinned tab and a “Work” group; and one more.
  const first = await openWindow(worker, [MAIL, GITHUB_A, GITHUB_B], [0]);
  const second = await openWindow(worker, [DOCS]);
  await worker.evaluate(async ({ first }) => {
    const groupId = await chrome.tabs.group({ tabIds: [first.tabIds[1], first.tabIds[2]], createProperties: { windowId: first.windowId } });
    await chrome.tabGroups.update(groupId, { title: 'Work', color: 'red' });
  }, { first });
  await click(worker, 'save-window-workspace', first.tabIds[1]);
  const [saved] = await workspaces();

  const page = await context.newPage();
  page.on('pageerror', (error) => fail(`page error: ${error.message}`));
  await page.goto(url('options/options.html#workspaces'));
  // The settings page has the window Chrome started with to itself (its blank tab closed).
  await worker.evaluate(async () => chrome.tabs.remove((await chrome.tabs.query({ url: 'about:blank' })).flatMap((tab) => tab.id ?? [])));
  const pageWindow = await page.evaluate(async () => (await chrome.tabs.getCurrent())?.windowId ?? -1);
  const rows = page.locator('#workspace-list > li');
  const snapshotRows = page.locator('#snapshot-list > li');
  const toast = () => page.locator('#toast-text').innerText();
  /** @param {import('playwright').Locator} row @param {string} name - A row's ⋮ menu item. */
  const choose = async (row, name) => {
    await row.getByRole('button', { name: /^More actions for/ }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  await until(async () => (await rows.count()) === 1, 'the workspace row');
  const file = path.join(profile.dir, '..', 'exported.json');

  await check('Export downloads one file of ours: named with the day, versioned, the workspace without its id', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
    assert.match(download.suggestedFilename(), /^better-tab-actions-workspaces-\d{4}-\d\d-\d\d\.json$/);
    await download.saveAs(file);
    const exported = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual([exported.app, exported.kind, exported.version, exported.workspaces.length], ['better-tab-actions', 'workspaces', 1, 1]);
    assert.deepEqual(exported.workspaces[0], { name: saved.name, savedAt: saved.savedAt, skipped: saved.skipped, windows: saved.windows });
    assert.equal(await toast(), 'Exported 1 workspace');
  });

  await check('Import says what the file would add, and adds nothing until that’s confirmed; then the workspace is back, and Undo takes it away', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ workspaces: [] }));
    await until(async () => (await rows.count()) === 0, 'the list to empty');
    assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isDisabled(), true, 'nothing to export');
    await page.setInputFiles('#import-file', file);
    const dialog = page.locator('#confirm-dialog');
    await until(() => dialog.isVisible(), 'the confirmation');
    assert.equal(await dialog.locator('.dialog-title').innerText(), 'Import workspaces');
    assert.equal(await dialog.locator('.dialog-body').innerText(), '1 new workspace');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.deepEqual(await workspaces(), []);

    await page.setInputFiles('#import-file', file);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await until(async () => (await rows.count()) === 1, 'the imported row');
    const [back] = await workspaces();
    assert.deepEqual({ ...back, id: '' }, { ...saved, id: '' });
    assert.equal(await toast(), 'Imported 1 workspace');
    await page.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await workspaces()).length === 0, 'Undo');
    await page.setInputFiles('#import-file', file);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await until(async () => (await workspaces()).length === 1, 'the workspace again');
  });

  await check('the same file again adds nothing and says so; a file with a tab that can’t be reopened says how many; one that isn’t ours is refused', async () => {
    await page.setInputFiles('#import-file', file);
    await until(async () => (await toast()) === 'Nothing new to import: 1 already here', 'the toast');
    assert.equal((await workspaces()).length, 1);

    const mixed = path.join(profile.dir, '..', 'mixed.json');
    const exported = JSON.parse(await readFile(file, 'utf8'));
    exported.workspaces.push({ name: 'From elsewhere', windows: [{ tabs: [{ url: 'javascript:alert(1)' }, { url: 'https://me:secret@news.example/' }] }] });
    await writeFile(mixed, JSON.stringify(exported));
    await page.setInputFiles('#import-file', mixed);
    const dialog = page.locator('#confirm-dialog');
    await until(() => dialog.isVisible(), 'the confirmation');
    assert.equal(await dialog.locator('.dialog-body').innerText(), '1 new workspace, 1 already here, 1 tab that can’t be reopened');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await until(async () => (await workspaces()).length === 2, 'the new workspace');
    const added = (await workspaces()).find((w) => w.name === 'From elsewhere');
    assert.deepEqual(added?.windows[0].tabs.map((tab) => tab.url), ['https://news.example/'], 'without the javascript: tab, or the password');

    const other = path.join(profile.dir, '..', 'other.json');
    await writeFile(other, JSON.stringify({ workspaces: [{ name: 'x', windows: [{ tabs: [{ url: 'https://a.example/' }] }] }] }));
    await page.setInputFiles('#import-file', other);
    await until(async () => (await toast()) === 'That isn’t a Better Tab Actions workspaces file', 'the refusal');
    exported.version = 2;
    await writeFile(other, JSON.stringify(exported));
    await page.setInputFiles('#import-file', other);
    await until(async () => (await toast()).startsWith('That file is from a newer version of Better Tab Actions.'), 'the newer-version refusal');
    assert.equal((await workspaces()).length, 2);
  });

  await check('“Open in this window”: the workspace’s tabs open after the settings tab, the pinned one pinned, “Work” grouped, and the settings tab stays in front', async () => {
    const windowsBefore = await worker.evaluate(async () => (await chrome.windows.getAll()).length);
    const row = rows.filter({ hasText: saved.name });
    await choose(row, 'Open in this window');
    await until(async () => (await strip(pageWindow)).length === 4 && (await strip(pageWindow)).at(-1)?.endsWith('[Work]'), 'the three tabs');
    assert.deepEqual(await strip(pageWindow), [`${MAIL} pinned`, url('options/options.html#workspaces'), `${GITHUB_A} [Work]`, `${GITHUB_B} [Work]`]);
    assert.equal(await worker.evaluate(async () => (await chrome.windows.getAll()).length), windowsBefore, 'no new window');
    assert.equal(await page.evaluate(async () => (await chrome.tabs.getCurrent())?.active), true);
    await worker.evaluate(async (windowId) => {
      const extra = (await chrome.tabs.query({ windowId })).filter((tab) => !tab.active).flatMap((tab) => tab.id ?? []);
      await chrome.tabs.remove(extra);
    }, pageWindow);
  });

  await check('“Take snapshot” keeps the open windows (not the settings tab) and lists the snapshot under its time, newest first', async () => {
    assert.equal(await snapshotRows.count(), 0);
    const before = Date.now();
    await page.getByRole('button', { name: 'Take snapshot' }).click();
    await until(async () => (await snapshotRows.count()) === 1, 'the snapshot row');
    assert.equal(await toast(), 'Snapshot taken');
    const [snapshot] = await snapshots();
    assert.equal(snapshot.auto, false);
    assert.deepEqual(snapshot.windows.map((win) => win.tabs.map((tab) => tab.url)), [[MAIL, GITHUB_A, GITHUB_B], [DOCS]]);
    assert.deepEqual(snapshot.windows[0].groups.map((g) => g.title), ['Work']);
    const time = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const text = await snapshotRows.first().innerText();
    assert.ok([before, Date.now()].some((at) => text === `${time.format(at)}\n2 windows · 4 tabs · Taken by you`), text);
  });

  await check('“Take snapshots automatically”: off until turned on; then the alarm is set at the chosen time and a first snapshot taken', async () => {
    assert.deepEqual(await worker.evaluate(() => chrome.alarms.getAll()), []);
    assert.equal(await page.locator('#auto-snapshot-options').isVisible(), false);
    await page.getByRole('switch', { name: 'Take snapshots automatically' }).click();
    await page.locator('#snapshotMinutes').selectOption({ label: '5 minutes' });
    await until(async () => (await worker.evaluate(() => chrome.alarms.get('take-snapshot')))?.periodInMinutes === 5, 'the alarm every 5 minutes');
    // An automatic one keeps every window, the settings page's too.
    await until(async () => (await snapshots()).length === 2, 'the first automatic snapshot');
    assert.deepEqual((await snapshots()).map((s) => [s.auto, s.windows.length]), [[true, 3], [false, 2]]);
  });

  await check('an alarm takes a snapshot only once the windows have changed: not for a new title, yes for a new tab', async () => {
    const mail = context.pages().find((p) => p.url() === MAIL);
    await mail?.evaluate(() => { document.title = '(3) Inbox'; });
    await until(() => worker.evaluate(async (id) => (await chrome.tabs.get(id)).title === '(3) Inbox', first.tabIds[0]), 'the new title');
    await alarmNow();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal((await snapshots()).length, 2, 'a title alone isn’t a change');

    await worker.evaluate((windowId) => chrome.tabs.create({ windowId, url: 'https://news.example/', active: false }), second.windowId);
    await alarmNow();
    await until(async () => (await snapshots()).length === 3, 'the automatic snapshot');
    const [latest] = await snapshots();
    assert.equal(latest.auto, true);
    assert.ok(latest.windows.some((win) => win.tabs.map((tab) => tab.url).join() === [DOCS, 'https://news.example/'].join()), JSON.stringify(latest.windows));
    await until(async () => (await snapshotRows.count()) === 3, 'its row');
    assert.match(await snapshotRows.first().innerText(), /\n3 windows · 6 tabs · Automatic$/);
  });

  await check('a snapshot’s row: “Save as workspace” makes a workspace named after its sites; “Open” reopens its windows; “Delete” removes it, with Undo', async () => {
    await choose(snapshotRows.first(), 'Save as workspace');
    await until(async () => (await workspaces()).length === 3, 'the new workspace');
    await until(async () => (await toast()).startsWith('Saved as workspace'), 'the toast');
    const [made] = await workspaces();
    assert.equal(await toast(), `Saved as workspace “${made.name}”`);
    assert.deepEqual(made.windows, (await snapshots())[0].windows);

    const before = await worker.evaluate(async () => (await chrome.windows.getAll()).flatMap((win) => win.id ?? []));
    await choose(snapshotRows.last(), 'Open'); // The one taken by hand: the two windows.
    await until(async () => (await worker.evaluate(async () => (await chrome.windows.getAll()).length)) === before.length + 2, 'two more windows');
    const opened = await worker.evaluate(async (before) => (await chrome.windows.getAll()).flatMap((win) => (win.id === undefined || before.includes(win.id) ? [] : [win.id])), before);
    assert.deepEqual(await strip(opened[0]), [`${MAIL} pinned`, `${GITHUB_A} [Work]`, `${GITHUB_B} [Work]`]);

    await choose(snapshotRows.first(), 'Delete');
    await until(async () => (await snapshots()).length === 2, 'the deletion');
    await page.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await snapshots()).length === 3 && (await snapshotRows.count()) === 3, 'Undo');
    assert.equal((await snapshots())[0].auto, true, 'back in its place, newest first');
  });

  await check('none of this needs a permission: Chrome’s install warnings are the same two', async () => {
    const manifest = JSON.parse(await readFile(path.join(EXTENSION, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.permissions, ['contextMenus', 'tabs', 'tabGroups', 'storage', 'offscreen', 'alarms']);
    assert.deepEqual(await installWarnings(worker, manifest), ['Read your browsing history', 'View and manage your tab groups']);
  });
}, [close, profile.remove]);
