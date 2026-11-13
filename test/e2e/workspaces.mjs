/**
 * Real-browser check of workspaces: the test build in Playwright's Chromium, driven as a click
 * in the tab menu and a keyboard shortcut drive it (the test hook), and the real settings page.
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
 * 4. A window saved where no screen is now (a display since unplugged) still opens.
 * 5. The settings page: the row and its summary, then Open, Rename, Replace with current windows
 *    (and Undo) and Delete (and Undo) from its ⋮ menu, the keyboard focus staying in the list.
 *
 * @module test/e2e/workspaces
 */
import assert from 'node:assert/strict';
import { checkRunner, runChecks, savedTabGroups, until } from '@arraypress/extension-kit/testing';
import { click, openWindow, press, serveExampleSites, testProfile } from './helpers.mjs';

/** @import { Worker } from 'playwright' */
/** @import { Workspace } from '../../extension/shared/workspaces.js' */

const profile = await testProfile('bta-workspaces-');
const runner = checkRunner();
const { check } = runner;
/** @type {(() => Promise<void>) | undefined} The browser that's open now, closed if a check leaves it open. */
let closeOpen;

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

await runChecks(runner, async () => {
  /** Start the browser on the profile, with the made-up sites answered. */
  const launch = async () => {
    const launched = await profile.launch();
    closeOpen = launched.close;
    return { ...launched, hits: await serveExampleSites(launched.context) };
  };
  /** @type {string} */
  let workspaceId = '';
  const started = await launch();
  const { hits } = started;
  let { worker, close } = started;
  /** @type {{windowId: number, tabIds: number[]}} */
  let first;
  /** @type {{windowId: number, tabIds: number[]}} */
  let second;

  await check('“Save windows as workspace” keeps both windows, names it after their main sites and lists it under Open workspace', async () => {
    const start = await windowIds(worker); // Playwright's, with a blank tab: closed below, so it isn't saved.
    first = await openWindow(worker, [MAIL, GITHUB_A, GITHUB_B, NEWS], [0]);
    second = await openWindow(worker, [DOCS_1, DOCS_2]);
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
  });

  await check('reopened from its shortcut: two windows, tab order, pinned tab, red collapsed “Reading” group, maximized window; only each window’s active tab loaded', async () => {
    await worker.evaluate((ids) => Promise.all(ids.map((id) => chrome.windows.remove(id))), [first.windowId, second.windowId]);
    hits.clear();
    const opened = await press(worker, 'open-workspace'); // The keyboard shortcut: the latest workspace.
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
  });

  await check('an unloaded tab loads when clicked', async () => {
    await worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id ?? -1, { active: true });
    }, DOCS_2);
    await until(() => hits.get(DOCS_2), 'the clicked tab to load');
  });

  await check('Chromium saves every reopened group again (pinned to the bar): two “Reading” groups now', async () => {
    await close();
    const reading = (await savedTabGroups(profile.dir)).filter((g) => g.title === 'Reading');
    assert.equal(reading.length, 2, 'Chrome saved the reopened group as a second “Reading”');
    assert.ok(reading.every((g) => g.pinned && g.urls.join() === [GITHUB_B, NEWS].join()), JSON.stringify(reading));
  });

  await check('with “Reopen tab groups” off, tabs reopen ungrouped and Chrome saves nothing more', async () => {
    ({ worker, close } = await launch());
    await worker.evaluate(() => chrome.storage.sync.set({ reopenGroups: false }));
    const start = await windowIds(worker);
    const [tabId] = await worker.evaluate(async () => (await chrome.tabs.query({})).flatMap((tab) => tab.id ?? []));
    await click(worker, `open-workspace:${workspaceId}`, tabId); // Its item in the submenu.
    const [reopened] = await describeWindows(worker, start);
    assert.ok(reopened.tabs.every((tab) => !tab.includes('[')), `no groups: ${reopened.tabs}`);
    await worker.evaluate(() => chrome.storage.sync.set({ reopenGroups: true }));
    await close();
    assert.equal((await savedTabGroups(profile.dir)).filter((g) => g.title === 'Reading').length, 2);
  });

  const last = await launch();
  ({ worker } = last);
  await check('a window saved where no screen is now (a display since unplugged) still opens', async () => {
    // Chrome itself refuses these bounds: “Bounds must be at least 50% within visible screen space”.
    const refused = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', left: 100_000, top: 100_000, width: 700, height: 500 }).then(() => '', (error) => String(error.message)));
    assert.match(refused, /Bounds must be at least 50% within visible screen space/);
    const all = await stored(worker);
    const moved = { ...all[0], windows: [{ ...all[0].windows[1], state: /** @type {const} */ ('normal'), left: 100_000, top: 100_000, width: 700, height: 500 }] };
    await worker.evaluate((workspaces) => chrome.storage.local.set({ workspaces }), [moved]);
    try {
      const start = await windowIds(worker);
      const [tabId] = await worker.evaluate(async () => (await chrome.tabs.query({})).flatMap((tab) => tab.id ?? []));
      assert.equal((await click(worker, `open-workspace:${moved.id}`, tabId)).length, 2);
      // (Its size can't be read back here: Playwright sets every window's size itself, a moment after it opens.)
      assert.deepEqual((await describeWindows(worker, start)).map((win) => win.tabs), [[DOCS_1, `${DOCS_2} unloaded`]]);
    } finally {
      await worker.evaluate((workspaces) => chrome.storage.local.set({ workspaces }), all);
    }
  });

  // The settings page.
  const { context, url } = last;
  const page = await context.newPage();
  await page.goto(url('options/options.html#workspaces'));
  const rows = page.locator('#workspace-list > li');
  /** @param {string} name - A menu item. */
  const choose = async (name) => {
    await rows.first().getByRole('button', { name: /^More actions for/ }).click();
    await page.getByRole('menuitem', { name }).click();
  };
  /** What has the keyboard focus: its accessible name, or its id. */
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? '');

  await check('the settings page lists it: name, windows, tabs and the day it was saved', async () => {
    await until(async () => (await rows.count()) === 1, 'the workspace row');
    const today = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(Date.now());
    assert.equal(await rows.first().innerText(), `github.example and docs.example\n2 windows · 6 tabs · Saved ${today}`);
    assert.equal(await page.locator('#reopenGroups').isChecked(), true);
  });

  await check('Open: the two windows open', async () => {
    const before = (await windowIds(worker)).length;
    await choose('Open');
    await until(async () => (await windowIds(worker)).length === before + 2, 'two windows to open');
  });

  await check('Rename: stored and shown, and the keyboard focus is on the renamed row’s ⋮ button, not lost to the page', async () => {
    await page.bringToFront();
    await choose('Rename');
    await page.locator('#text-dialog-input').fill('Research');
    await page.locator('#text-dialog-confirm').click();
    await until(async () => (await stored(worker))[0]?.name === 'Research', 'the new name to be stored');
    await until(async () => (await rows.first().innerText()).startsWith('Research\n'), 'the row to show it');
    await until(async () => (await focused()) === 'More actions for “Research”', 'the focus on the row’s button');
  });

  await check('Replace with current windows: the open windows, not the settings tab; Undo puts it back', async () => {
    await worker.evaluate(() => chrome.windows.create({ url: 'https://extra.example/', focused: false }));
    await choose('Replace with current windows');
    await until(async () => (await stored(worker))[0]?.windows.some((w) => w.tabs.some((t) => t.url === 'https://extra.example/')), 'the replaced windows');
    const replaced = (await stored(worker))[0];
    assert.equal(replaced.name, 'Research');
    assert.ok(!replaced.windows.some((w) => w.tabs.some((t) => t.url.includes('/options/options.html'))), 'the settings tab is left out');
    assert.equal(await page.locator('#toast-text').innerText(), 'Replaced “Research” with your current windows');
    await page.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await stored(worker))[0]?.windows.length === 2 && !(await stored(worker))[0].windows.some((w) => w.tabs.some((t) => t.url === 'https://extra.example/')), 'Undo');
  });

  await check('Delete: gone, with the empty line, the focus moved on to the card’s switch; Undo brings it back', async () => {
    await choose('Delete');
    await until(async () => (await stored(worker)).length === 0, 'the deletion');
    await until(() => page.locator('#no-workspaces').isVisible(), 'the empty line');
    assert.equal(await page.locator('#toast-text').innerText(), 'Deleted “Research”');
    await until(async () => (await focused()) === 'reopenGroups', 'the focus on “Reopen tab groups”');
    await page.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await rows.count()) === 1, 'the row to come back');
  });
}, [async () => { await closeOpen?.().catch(() => {}); }, profile.remove]);
