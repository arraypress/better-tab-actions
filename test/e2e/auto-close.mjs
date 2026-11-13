/**
 * Real-browser check of "Close unused tabs automatically", on a test build where an hour is a
 * second and the check runs every 1.2 seconds (.test-builds/auto-close/: the e2e build with two
 * constants changed in background/auto-close.js):
 *
 * 1. `alarms` adds no install warning: Chrome's own warnings for the manifest, with and without it.
 * 2. With the setting on, unused tabs close; the active, pinned, grouped (with grouped tabs left
 *    alone) and never-close-site tabs stay.
 * 3. Only time Chrome was running and awake counts: with no check for longer than the chosen time
 *    (the alarm taken away and put back, as it's silent while the computer sleeps), a tab stays
 *    until it has gone unused that long awake.
 * 4. Turning it off clears the alarm; "Reopen closed tabs" brings the closed ones back in their places.
 * 5. The settings page: the switch shows the age list and the site list; Add (refusing what isn't
 *    a site), Edit and Remove; the Memory Saver row opens chrome://settings/performance.
 * 6. Chrome closed and started again: the time it was closed is kept as away time.
 *
 *   npm run e2e
 *
 * @module test/e2e/auto-close
 */
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRunner, runChecks, until, warningsAddedBy } from '@arraypress/extension-kit/testing';
import { buildE2e } from '../../scripts/build-e2e.mjs';
import { click, EXTENSION, openWindow, serveExampleSites, testProfile } from './helpers.mjs';

/** @import { Worker } from 'playwright' */
/** @import { AwakeClock } from '../../extension/background/auto-close.js' */

const build = await buildE2e('auto-close');
const moduleFile = path.join(build, 'background', 'auto-close.js');
const source = await readFile(moduleFile, 'utf8');
const fast = source
  .replace('export const CHECK_MINUTES = 5;', 'export const CHECK_MINUTES = 0.02;')
  .replace('export const HOUR_MS = 60 * 60 * 1000;', 'export const HOUR_MS = 1000;');
assert.equal(fast.split('\n').filter((line, i) => line !== source.split('\n')[i]).length, 2, 'both constants changed in the test build');
await writeFile(moduleFile, fast);

const profile = await testProfile('bta-auto-close-', build);
const first = await profile.launch();
const { worker, context, url } = first;
/** Closes the browser that's open now (a later check starts Chrome again). */
let close = first.close;
const runner = checkRunner();
const { check } = runner;

/**
 * A window's tabs' addresses (pending ones included), in order.
 *
 * @param {Worker} w - The service worker.
 * @param {number} windowId - The window.
 * @returns {Promise<string[]>} Their addresses.
 */
const strip = (w, windowId) => w.evaluate(async (windowId) => (await chrome.tabs.query({ windowId })).map((tab) => tab.url || tab.pendingUrl || ''), windowId);

await runChecks(runner, async () => {
  await serveExampleSites(context);

  await check('alarms adds no install warning: Chrome lists “Read your browsing history” and “View and manage your tab groups” with and without it', async () => {
    const manifest = JSON.parse(await readFile(path.join(EXTENSION, 'manifest.json'), 'utf8'));
    const { warnings, without } = await warningsAddedBy(worker, manifest, ['alarms']);
    assert.ok(manifest.permissions.includes('alarms'));
    assert.deepEqual(warnings, without);
    assert.deepEqual(warnings, ['Read your browsing history', 'View and manage your tab groups']);
  });

  const urls = ['https://pinned.example/', 'https://old.example/1', 'https://grouped.example/', 'https://keep.example/', 'https://old.example/2', 'https://front.example/'];
  const { windowId, tabIds } = await openWindow(worker, urls, [0]);

  await check('unused tabs close; the pinned, grouped, never-close-site and current tabs stay', async () => {
    await worker.evaluate(async ({ windowId, tabIds }) => {
      await chrome.tabs.group({ tabIds: [tabIds[2]], createProperties: { windowId } });
      await chrome.tabs.update(tabIds[5], { active: true });
      await chrome.storage.sync.set({ autoClose: true, autoCloseHours: 1, keepSites: ['keep.example'], includeGroupedTabs: false });
    }, { windowId, tabIds });
    await until(async () => (await strip(worker, windowId)).length === 4, 'the unused tabs to close', 20_000);
    assert.deepEqual(await strip(worker, windowId), [urls[0], urls[2], urls[3], urls[5]]);
  });

  /**
   * The awake clock as stored.
   *
   * @param {Worker} w - The service worker.
   * @returns {Promise<AwakeClock | undefined>} The clock.
   */
  const clock = (w) => w.evaluate(async () => /** @type {AwakeClock | undefined} */ ((await chrome.storage.local.get('awakeClock')).awakeClock));

  await check('asleep for longer than the chosen time (no check fires): the tab is still there on waking, and closes only after that long awake', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ autoCloseHours: 4 })); // Four “hours”: four seconds here.
    const later = await worker.evaluate(async (windowId) => (await chrome.tabs.create({ windowId, url: 'https://later.example/', active: false })).id, windowId);
    /** Whether the tab is still open. */
    const open = () => worker.evaluate((id) => chrome.tabs.get(id ?? -1).then(() => true, () => false), later);
    const before = (await clock(worker))?.away.length ?? 0;
    // The lid shuts: no alarm fires. Six seconds later it opens, and the missed alarm fires once.
    const alarm = await worker.evaluate(async () => {
      const alarm = await chrome.alarms.get('close-unused-tabs');
      await chrome.alarms.clear('close-unused-tabs');
      return alarm;
    });
    await new Promise((resolve) => setTimeout(resolve, 6000));
    assert.equal(await open(), true);
    const woke = Date.now();
    await worker.evaluate((period) => chrome.alarms.create('close-unused-tabs', { when: Date.now(), periodInMinutes: period }), alarm?.periodInMinutes);
    const [left, back] = await until(async () => {
      const stretches = (await clock(worker))?.away ?? [];
      return stretches.length > before && stretches.at(-1);
    }, 'the first check after waking');
    assert.ok(back - left >= 5000, `the sleep is kept as away time: ${back - left} ms`);
    assert.equal(await open(), true, 'unused for six seconds by the wall clock, but not for four of them awake');
    await until(async () => !(await open()), 'the tab to close', 30_000);
    assert.ok(Date.now() - woke >= 3000, `closed ${Date.now() - woke} ms after waking, not at once`);
    await worker.evaluate(() => chrome.storage.sync.set({ autoCloseHours: 1 }));
  });

  await check('off: the alarm stops; Reopen closed tabs puts the closed tabs back in their places', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ autoClose: false }));
    await until(() => worker.evaluate(async () => !(await chrome.alarms.get('close-unused-tabs'))), 'the alarm to stop');
    await click(worker, 'reopen-closed-tabs', tabIds[5]);
    await until(async () => (await strip(worker, windowId)).join() === [...urls.slice(0, 4), 'https://later.example/', ...urls.slice(4)].join(), 'the closed tabs back in their places');
    assert.equal(await clock(worker), undefined, 'no clock is kept while it’s off');
  });

  const page = await context.newPage();
  await page.goto(url('options/options.html'));
  const rows = page.locator('#site-list > li');
  const field = page.locator('#text-dialog-input');

  await check('settings page: the switch shows six ages and the site list', async () => {
    const options = page.locator('#auto-close-options');
    await until(async () => page.locator('#autoClose').isVisible(), 'the page');
    assert.equal(await options.isVisible(), false, 'the age and sites show only while it’s on');
    await page.locator('#autoClose').click();
    await until(() => options.isVisible(), 'the options to show');
    assert.deepEqual(await page.locator('#autoCloseHours option').allInnerTexts(), ['1 hour', '4 hours', '12 hours', '1 day', '3 days', '1 week']);
    assert.equal(await page.locator('#autoCloseHours').inputValue(), '1', 'what the earlier check stored');
    await page.locator('#autoCloseHours').selectOption({ label: '3 days' });
    assert.deepEqual(await rows.allInnerTexts(), ['keep.example']);
  });

  await check('settings page: Add refuses what isn’t a site; Edit and Remove; all synced', async () => {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await field.fill('not a site');
    assert.equal(await page.locator('#text-dialog-error').innerText(), 'Enter a site, like example.com');
    assert.equal(await page.locator('#text-dialog-confirm').isDisabled(), true);
    await field.fill('https://www.News.example/today');
    await field.press('Enter');
    await until(async () => (await rows.allInnerTexts()).join() === 'keep.example,news.example', 'the new row');
    await rows.nth(1).getByRole('button', { name: 'More actions for “news.example”' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await field.fill('sport.example');
    await page.locator('#text-dialog-confirm').click();
    await rows.first().getByRole('button', { name: 'More actions for “keep.example”' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await until(async () => {
      const { keepSites, autoClose, autoCloseHours } = await worker.evaluate(() => chrome.storage.sync.get(null));
      return JSON.stringify([keepSites, autoClose, autoCloseHours]) === JSON.stringify([['sport.example'], true, 72]);
    }, 'the settings to reach sync');
  });

  await check('the Memory Saver row opens chrome://settings/performance', async () => {
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: /^Memory Saver/ }).click();
    assert.equal((await opened).url(), 'chrome://settings/performance');
  });

  await check('Chrome closed and started again: the time it was closed is kept as away time, so it won’t count', async () => {
    // The settings page left automatic closing on; wait for a check, then quit Chrome.
    const { tick } = await until(() => clock(worker), 'the clock');
    await until(async () => ((await clock(worker))?.tick ?? 0) > tick, 'a check');
    const quit = Date.now();
    await close();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const second = await profile.launch();
    close = second.close;
    const away = await until(async () => {
      const stretch = (await clock(second.worker))?.away.at(-1);
      return stretch && stretch[1] > quit + 5000 && stretch;
    }, 'the first check after Chrome started', 30_000);
    assert.ok(away[0] <= quit && away[1] - away[0] >= 5000, `from before it quit to after it started: ${JSON.stringify(away)}, quit at ${quit}`);
  });
}, [() => close(), profile.remove, () => rm(build, { recursive: true, force: true })]);
