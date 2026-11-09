/**
 * Real-browser check of workspaces: loads extension/ in Playwright's Chromium and drives the
 * background's own handler (`runMenuAction`) and the real settings page.
 *
 *   npm run e2e
 *
 * 1. Two windows, one with a pinned tab and a red, collapsed group, are saved, closed and
 *    reopened: same windows, tab order, pinned tab, group (title, colour, collapsed) and state.
 * 2. Only each window's active tab loads: the others are discarded before any request and load
 *    when clicked.
 * 3. Chrome's saved tab groups (read from the closed profile, the kit's savedTabGroups): every group the
 *    extension reopens is saved again, pinned to the bar, so each reopen adds a copy; with
 *    "Reopen tab groups" off, none is added.
 * 4. The settings page: the row and its summary, then Open, Rename, Replace with current windows
 *    (and Undo) and Delete (and Undo) from its ⋮ menu.
 *
 * @module test/e2e/workspaces
 */
import assert from 'node:assert/strict';
import { savedTabGroups, until } from '@arraypress/extension-kit/testing';
import { click, openWindow, serveExampleSites, testProfile } from './helpers.mjs';

/** @import { Worker } from 'playwright' */
/** @import { Workspace } from '../../extension/shared/workspaces.js' */

const profile = await testProfile('mta-workspaces-');

/**
 * The saved workspaces, as stored.
 *
 * @param {Worker} worker - The service worker.
 * @returns {Promise<Workspace[]>} Most recent first.
 */
const stored = (worker) => worker.evaluate(async () => /** @type {Workspace[]} */ ((await chrome.storage.local.get('workspaces')).workspaces ?? []));

/**
 * Every window but the one Chrome started with, as "url" strings with " pinned", " unloaded" and
 * " [title colour collapsed]" when they apply, plus the window's state.
 *
 * @param {Worker} worker - The service worker.
 * @param {number[]} ignore - Windows to leave out.
 * @returns {Promise<{state?: string, tabs: string[]}[]>} The windows, oldest first.
 */
const describeWindows = (worker, ignore) => worker.evaluate(async (ignore) => {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g]));
  return windows.filter((win) => win.id !== undefined && !ignore.includes(win.id)).map((win) => ({
    state: win.state,
    tabs: (win.tabs ?? []).map((tab) => {
      const group = groups.get(tab.groupId);
      return `${tab.url || tab.pendingUrl}${tab.pinned ? ' pinned' : ''}${tab.discarded ? ' unloaded' : ''}${
        group ? ` [${group.title} ${group.color}${group.collapsed ? ' collapsed' : ''}]` : ''}`;
    }),
  }));
}, ignore);

/**
 * The ids of the open windows.
 *
 * @param {Worker} worker - The service worker.
 * @returns {Promise<number[]>} Their ids.
 */
const windowIds = (worker) => worker.evaluate(async () => (await chrome.windows.getAll()).flatMap((win) => win.id ?? []));

const MAIL = 'https://mail.example/';
const GITHUB_A = 'https://github.example/a';
const GITHUB_B = 'https://github.example/b';
const NEWS = 'https://news.example/';
const DOCS_1 = 'https://docs.example/1';
const DOCS_2 = 'https://docs.example/2';

try {
  /** @type {string} */
  let workspaceId;

  // 1–2. Save two windows, close them, reopen: the same windows; only the active tabs load.
  {
    const { worker, context, close } = await profile.launch();
    const hits = await serveExampleSites(context);
    const start = await windowIds(worker); // Playwright's, with a blank tab: closed below, so it isn't saved.
    const first = await openWindow(worker, [MAIL, GITHUB_A, GITHUB_B, NEWS], [0]);
    const second = await openWindow(worker, [DOCS_1, DOCS_2]);
    await worker.evaluate(async ({ first, second }) => {
      const groupId = await chrome.tabs.group({ tabIds: [first.tabIds[2], first.tabIds[3]], createProperties: { windowId: first.windowId } });
      await chrome.tabs.update(first.tabIds[1], { active: true }); // Collapsing needs the active tab outside the group.
      await chrome.tabGroups.update(groupId, { title: 'Reading', color: 'red', collapsed: true });
      await chrome.windows.update(second.windowId, { state: 'maximized' });
    }, { first, second });
    await worker.evaluate((ids) => Promise.all(ids.map((id) => chrome.windows.remove(id))), start);

    const saved = await click(worker, 'save-workspace', first.tabIds[1]);
    assert.equal(saved.length, 6, 'the six tabs of the two windows');
    const [workspace] = await stored(worker);
    workspaceId = workspace.id;
    assert.equal(workspace.name, 'github.example and docs.example');
    // The "Open workspace" submenu lists it (Chrome refuses to update an item that doesn't exist).
    await until(() => worker.evaluate((id) => chrome.contextMenus.update(`open-workspace:${id}`, {}).then(() => true, () => false), workspaceId), 'the submenu item');
    console.log(`✔ saved “${workspace.name}”, listed under Open workspace`);

    await worker.evaluate((ids) => Promise.all(ids.map((id) => chrome.windows.remove(id))), [first.windowId, second.windowId]);
    hits.clear();
    const opened = await click(worker, 'open-workspace'); // The keyboard shortcut: the latest workspace.
    assert.equal(opened.length, 6);
    await new Promise((r) => setTimeout(r, 1500)); // Time for any tab that was going to load.
    assert.deepEqual(await describeWindows(worker, []), [
      {
        state: 'normal',
        tabs: [`${MAIL} pinned unloaded`, GITHUB_A, `${GITHUB_B} unloaded [Reading red collapsed]`, `${NEWS} unloaded [Reading red collapsed]`],
      },
      { state: 'maximized', tabs: [DOCS_1, `${DOCS_2} unloaded`] },
    ]);
    assert.deepEqual([...hits.keys()].sort(), [DOCS_1, GITHUB_A], `only the active tabs asked for their pages: ${JSON.stringify([...hits])}`);
    console.log('✔ reopened: two windows, tab order, pinned tab, red collapsed “Reading” group, maximized window');
    console.log('✔ only each window’s active tab loaded; the rest are discarded and made no request');

    // Clicking an unloaded tab loads it.
    await worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id ?? -1, { active: true });
    }, DOCS_2);
    await until(() => hits.get(DOCS_2), 'the clicked tab to load');
    console.log('✔ an unloaded tab loads when clicked');
    await close();
  }

  // 3. Chrome's saved groups: the user's "Reading" and the reopened copy, both pinned.
  {
    const reading = (await savedTabGroups(profile.dir)).filter((g) => g.title === 'Reading');
    assert.equal(reading.length, 2, 'Chrome saved the reopened group as a second “Reading”');
    assert.ok(reading.every((g) => g.pinned && g.urls.join() === [GITHUB_B, NEWS].join()), JSON.stringify(reading));
    console.log('✔ Chromium saves every reopened group again (pinned to the bar): two “Reading” groups now');

    const { worker, context, close } = await profile.launch();
    await serveExampleSites(context);
    await worker.evaluate(() => chrome.storage.sync.set({ reopenGroups: false }));
    const start = await windowIds(worker);
    await click(worker, 'open-workspace', undefined, workspaceId);
    const [reopened] = await describeWindows(worker, start);
    assert.ok(reopened.tabs.every((tab) => !tab.includes('[')), `no groups: ${reopened.tabs}`);
    await worker.evaluate(() => chrome.storage.sync.set({ reopenGroups: true }));
    await close();
    assert.equal((await savedTabGroups(profile.dir)).filter((g) => g.title === 'Reading').length, 2);
    console.log('✔ with “Reopen tab groups” off, tabs reopen ungrouped and Chrome saves nothing more');
  }

  // 4. The settings page.
  {
    const { worker, context, url, close } = await profile.launch();
    await serveExampleSites(context);
    const page = await context.newPage();
    await page.goto(url('options/options.html#workspaces'));
    const rows = page.locator('#workspace-list > li');
    await until(async () => (await rows.count()) === 1, 'the workspace row');
    const today = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(Date.now());
    assert.equal(await rows.first().innerText(), `github.example and docs.example\n2 windows · 6 tabs · Saved ${today}`);
    assert.equal(await page.locator('#reopenGroups').isChecked(), true);
    /** @param {string} name - A menu item. */
    const choose = async (name) => {
      await rows.first().getByRole('button', { name: /^More actions for/ }).click();
      await page.getByRole('menuitem', { name }).click();
    };

    const before = (await windowIds(worker)).length;
    await choose('Open');
    await until(async () => (await windowIds(worker)).length === before + 2, 'two windows to open');
    console.log('✔ Open: the two windows open');

    await choose('Rename');
    await page.locator('#text-dialog-input').fill('Research');
    await page.locator('#text-dialog-confirm').click();
    await until(async () => (await stored(worker))[0]?.name === 'Research', 'the new name to be stored');
    await until(async () => (await rows.first().innerText()).startsWith('Research\n'), 'the row to show it');
    console.log('✔ Rename: stored and shown');

    await worker.evaluate(() => chrome.windows.create({ url: 'https://extra.example/', focused: false }));
    await choose('Replace with current windows');
    await until(async () => (await stored(worker))[0]?.windows.some((w) => w.tabs.some((t) => t.url === 'https://extra.example/')), 'the replaced windows');
    const replaced = (await stored(worker))[0];
    assert.equal(replaced.name, 'Research');
    assert.ok(!replaced.windows.some((w) => w.tabs.some((t) => t.url.includes('/options/options.html'))), 'the settings tab is left out');
    assert.equal(await page.locator('#toast-text').innerText(), 'Replaced “Research” with your current windows');
    await page.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await stored(worker))[0]?.windows.length === 2 && !(await stored(worker))[0].windows.some((w) => w.tabs.some((t) => t.url === 'https://extra.example/')), 'Undo');
    console.log('✔ Replace with current windows: the open windows, not the settings tab; Undo puts it back');

    await choose('Delete');
    await until(async () => (await stored(worker)).length === 0, 'the deletion');
    await until(() => page.locator('#no-workspaces').isVisible(), 'the empty line');
    assert.equal(await page.locator('#toast-text').innerText(), 'Deleted “Research”');
    await page.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await rows.count()) === 1, 'the row to come back');
    console.log('✔ Delete: gone, with the empty line; Undo brings it back');
    await close();
  }
} finally {
  await profile.remove();
}
