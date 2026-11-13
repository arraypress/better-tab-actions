/**
 * Real-browser check of "Close unused tabs automatically", on a test build where an hour is a
 * second and the check runs every 1.2 seconds (.test-builds/auto-close/: the e2e build with two
 * constants changed in background/auto-close.js):
 *
 * 1. `alarms` adds no install warning: Chrome's own warnings for the manifest, with and without it.
 * 2. With the setting on, unused tabs close; the active, pinned, grouped (with grouped tabs left
 *    alone) and never-close-site tabs stay; turning
 *    it off clears the alarm; "Reopen closed tabs" brings the closed ones back in their places.
 * 3. The settings page: the switch shows the age list and the site list; Add (refusing what isn't
 *    a site), Edit and Remove; the Memory Saver row opens chrome://settings/performance.
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

const build = await buildE2e('auto-close');
const moduleFile = path.join(build, 'background', 'auto-close.js');
const source = await readFile(moduleFile, 'utf8');
const fast = source
  .replace('export const CHECK_MINUTES = 5;', 'export const CHECK_MINUTES = 0.02;')
  .replace('export const HOUR_MS = 60 * 60 * 1000;', 'export const HOUR_MS = 1000;');
assert.equal(fast.split('\n').filter((line, i) => line !== source.split('\n')[i]).length, 2, 'both constants changed in the test build');
await writeFile(moduleFile, fast);

const profile = await testProfile('bta-auto-close-', build);
const { worker, context, url, close } = await profile.launch();
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

  await check('off: the alarm stops; Reopen closed tabs puts the closed tabs back in their places', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ autoClose: false }));
    await until(() => worker.evaluate(async () => !(await chrome.alarms.get('close-unused-tabs'))), 'the alarm to stop');
    await click(worker, 'reopen-closed-tabs', tabIds[5]);
    await until(async () => (await strip(worker, windowId)).join() === urls.join(), 'the closed tabs back in their places');
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
}, [close, profile.remove, () => rm(build, { recursive: true, force: true })]);
