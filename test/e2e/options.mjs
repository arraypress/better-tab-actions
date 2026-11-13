/**
 * Real-browser check of the options page: loads extension/ as an unpacked extension in
 * Playwright's Chromium and drives
 * the real page against real chrome.storage.
 *
 *   npm run e2e
 *
 * Checks: settings are written to Chrome Sync, a burst of clicks is one write, a change still
 * waiting is written as the page closes, the background's menu follows, there's no sync switch,
 * the About card shows the manifest's version and the links from about-links.js, the Keyboard
 * shortcuts card lists only the keys a person has set, and a switch turned on or off from the
 * keyboard keeps the focus.
 *
 * @module test/e2e/options
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { checkRunner, launchExtension, runChecks, until } from '@arraypress/extension-kit/testing';
import { ABOUT_LINKS } from '../../extension/options/about-links.js';
import { EXTENSION } from './helpers.mjs';

/**
 * The service worker's global scope, with this check's count of writes to Chrome Sync.
 *
 * @typedef {typeof globalThis & {syncWrites: number}} WorkerScope
 */

const { context, worker, url, close } = await launchExtension(chromium, EXTENSION, { prefix: 'bta-options-' });
const runner = checkRunner();
const { check, fail } = runner;

await runChecks(runner, async () => {
  // Local holds only what's this computer's: the toolbar glyph's scheme (toolbar-theme.js) aside, nothing.
  /** What sync and local hold (local without the toolbar glyph's key). */
  const stored = () => worker.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    delete local.toolbarDark;
    return { sync: await chrome.storage.sync.get(null), local };
  });
  /** How many times sync has changed since the count started. */
  const syncWrites = () => worker.evaluate(() => /** @type {WorkerScope} */ (globalThis).syncWrites);
  await worker.evaluate(() => {
    const scope = /** @type {WorkerScope} */ (globalThis);
    scope.syncWrites = 0;
    chrome.storage.sync.onChanged.addListener(() => { scope.syncWrites++; });
  });
  /**
   * Open the options page once its menu switches are drawn; an error in the page fails the run.
   *
   * @param {Record<string, string>} [keys] - Keyboard shortcuts as if a person had set them at
   *   chrome://extensions/shortcuts (no API sets one): what `chrome.commands.getAll` tells the page, by command.
   */
  const open = async (keys) => {
    const page = await context.newPage();
    page.on('pageerror', (error) => fail(`page error: ${error.message}`));
    if (keys) {
      await page.addInitScript((set) => {
        const getAll = chrome.commands.getAll.bind(chrome.commands);
        chrome.commands.getAll = /** @type {typeof chrome.commands.getAll} */ (async () => (await getAll()).map((command) => ({ ...command, shortcut: set[command.name ?? ''] ?? command.shortcut })));
      }, keys);
    }
    await page.goto(url('options/options.html'));
    await page.waitForFunction(() => document.getElementById('menu-items')?.children.length);
    return page;
  };

  await check('no sync switch; the About card comes last with the manifest’s version and the configured links', async () => {
    const page = await open();
    const text = await page.locator('main').innerText();
    assert.equal(await page.locator('#syncSettings').count(), 0);
    assert.doesNotMatch(text, /Sync settings/);
    const { version } = JSON.parse(await readFile(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
    assert.equal(await page.locator('#version').innerText(), `Version ${version}`);
    assert.match(text, /About Better Tab Actions\s+Better Tab Actions\s+Version [\d.]+\s+Get help with Better Tab Actions\s+Report an issue\s+Privacy policy\s*$/);
    assert.equal(await page.locator('#help').getAttribute('href'), ABOUT_LINKS.help);
    assert.equal(await page.locator('#report-issue').getAttribute('href'), ABOUT_LINKS.reportIssue);
    assert.equal(await page.locator('#privacy-policy').getAttribute('href'), ABOUT_LINKS.privacyPolicy);
    await page.close();
  });

  await check('Chrome reads the words from _locales: the manifest’s name, toolbar title and commands, and the page’s title, headings and bold menu names', async () => {
    const manifest = await worker.evaluate(async () => ({
      name: chrome.runtime.getManifest().name,
      description: chrome.runtime.getManifest().description,
      toolbar: await chrome.action.getTitle({}),
      commands: (await chrome.commands.getAll()).filter((command) => command.name !== '_execute_action').map((command) => command.description),
    }));
    assert.equal(manifest.name, 'Better Tab Actions');
    assert.match(manifest.description ?? '', /^More actions for Chrome’s tab right-click menu/);
    assert.equal(manifest.toolbar, 'Better Tab Actions settings');
    assert.equal(manifest.commands.length, 14);
    assert.ok(manifest.commands.includes('Switch to last used tab') && manifest.commands.includes('Close tabs from this site'));
    assert.deepEqual(manifest.commands.filter((description) => !description || description.includes('__MSG_')), []);

    const page = await open();
    assert.equal(await page.title(), 'Better Tab Actions settings');
    assert.equal(await page.locator('h1').innerText(), 'Better Tab Actions');
    assert.deepEqual(await page.locator('h2').allInnerTexts(), ['Menu', 'Workspaces', 'Snapshots', 'Closing tabs', 'Keyboard shortcuts', 'About Better Tab Actions']);
    assert.equal(await page.locator('#menu-intro').innerText(), 'Choose what appears under More tab actions when you right-click a tab. Hidden actions still work from keyboard shortcuts.');
    assert.deepEqual(await page.locator('#menu-intro strong').allInnerTexts(), ['More tab actions']);
    assert.equal(await page.locator('#no-workspaces-text').innerText(), 'Workspaces you save appear here. To save your windows, right-click a tab and choose More tab actions › Save windows as workspace.');
    assert.deepEqual(await page.locator('#no-workspaces-text strong').allInnerTexts(), ['More tab actions', 'Save windows as workspace']);
    assert.equal(await page.locator('#workspaces-full-text').textContent(), 'You can keep up to 40 workspaces. Delete one to save another.');
    assert.deepEqual(await page.locator('#windowScope option').allInnerTexts(), ['This window only', 'All windows']);
    // Nothing on the page is left without its words, or showing a message's key.
    assert.deepEqual(await page.locator('[data-i18n]').evaluateAll((elements) => elements.filter((element) => !element.textContent?.trim() || element.textContent === element.getAttribute('data-i18n')).map((element) => element.getAttribute('data-i18n'))), []);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en-GB');
    await page.close();
  });

  await check('no keyboard shortcut is set by default: the card says so and leads to Chrome’s page', async () => {
    const page = await open();
    assert.equal(await page.locator('#shortcuts .row').count(), 0);
    assert.equal(await page.locator('#edit-shortcuts').innerText(), 'Keyboard shortcuts\nNone set yet. Add them on Chrome’s Keyboard shortcuts page.');
    const opened = context.waitForEvent('page');
    await page.locator('#edit-shortcuts').click();
    const shortcuts = await opened;
    assert.equal(shortcuts.url(), 'chrome://extensions/shortcuts');
    await shortcuts.close();
    await page.close();
  });

  await check('keys a person has set are listed, in the menu’s order with “Switch to last used tab” first; the rest aren’t', async () => {
    const page = await open({ 'sort-tabs-by-site': '⌃⇧S', 'switch-last-tab': '⌃⇧L', 'close-site-tabs': '⌃⇧W' });
    assert.deepEqual(await page.locator('#shortcuts .row').allInnerTexts(), ['Switch to last used tab\n⌃⇧L', 'Close tabs from this site\n⌃⇧W', 'Sort tabs by site\n⌃⇧S']);
    assert.equal(await page.locator('#no-shortcuts').isVisible(), false);
    assert.equal(await page.locator('#edit-shortcuts').innerText(), 'Keyboard shortcuts');
    await page.close();
  });

  await check('a burst of clicks is one write to Chrome Sync, after the clicks stop; the page and the menu read it back', async () => {
    const page = await open();
    const grouped = page.locator('#includeGroupedTabs');
    for (let i = 0; i < 9; i++) await grouped.click(); // Ends off.
    await page.locator('#windowScope').selectOption('all');
    await page.locator('#inactiveDays').fill('30');
    await page.locator('#inactiveDays').dispatchEvent('change');
    assert.equal(await syncWrites(), 0, 'nothing written mid-burst');
    await until(async () => (await stored()).sync.inactiveDays === 30, 'the settings to reach sync');
    await page.waitForTimeout(1500);
    assert.equal(await syncWrites(), 1);
    assert.deepEqual(await stored(), { sync: { includeGroupedTabs: false, windowScope: 'all', inactiveDays: 30 }, local: {} });
    // The background rebuilt the menu from sync: the inactive item names the new days.
    await until(() => worker.evaluate(() =>
      chrome.contextMenus.update('close-inactive-tabs', { title: 'Close tabs not used in 30 days' }).then(() => true, () => false)), 'the menu');
    await page.reload();
    await page.waitForFunction(() => /** @type {HTMLInputElement | null} */ (document.getElementById('inactiveDays'))?.value === '30');
    assert.equal(await grouped.isChecked(), false);
    await page.close();
  });

  await check('closing the page writes a change still waiting', async () => {
    const page = await open();
    await page.locator('#windowScope').selectOption('window');
    await page.close({ runBeforeUnload: true });
    await until(async () => (await stored()).sync.windowScope === 'window', 'the change to reach sync');
  });

  await check('a switch turned off and on from the keyboard keeps the focus, and Tab goes on to the next switch', async () => {
    const page = await open();
    const switches = page.locator('#menu-items input');
    await switches.nth(2).focus();
    await page.keyboard.press('Space');
    assert.equal(await switches.nth(2).isChecked(), false);
    assert.equal(await switches.nth(2).evaluate((element) => element === document.activeElement), true, 'still on the switch just turned off');
    await page.keyboard.press('Space');
    assert.equal(await switches.nth(2).isChecked(), true);
    await page.keyboard.press('Tab');
    assert.equal(await switches.nth(3).evaluate((element) => element === document.activeElement), true);
    await page.close();
  });

  await check('the Menu card lists the actions as the menu reads: the everyday ones, then “Close” and “Groups and workspaces” over theirs', async () => {
    const page = await open();
    assert.deepEqual(await page.locator('#menu-items > *').evaluateAll((rows) => rows.map((row) => `${row.matches('label') ? '' : '# '}${/** @type {HTMLElement} */ (row).innerText.trim()}`)), [
      'Close tabs from this site', 'Close other tabs from this site', 'Close duplicate tabs', 'Reopen closed tabs', 'Sort tabs by site', 'Mute other tabs',
      'Open workspace',
      '# Close', 'Close tabs not used in 30 days', 'Close tabs to the left',
      '# Groups and workspaces', 'Save this window as a group', 'Close window and keep as group', 'Save windows as workspace', 'Save this window as workspace',
    ]);
    await page.close();
  });

  await check('the days’ unit follows the number, here and in the menu’s label: “1 day”, “30 days”; an emptied field keeps its number', async () => {
    const page = await open();
    const days = page.locator('#inactiveDays');
    /** The number field and its unit, and the Menu card's row for the inactive action. */
    const shown = async () => [`${await days.inputValue()} ${await page.locator('#days-unit').innerText()}`, await page.locator('#menu-items label').nth(7).innerText()];
    assert.deepEqual(await shown(), ['30 days', 'Close tabs not used in 30 days']);
    await days.fill('1');
    await days.press('Enter');
    assert.deepEqual(await shown(), ['1 day', 'Close tabs not used in 1 day']);
    await days.fill('900');
    await days.press('Tab');
    assert.deepEqual(await shown(), ['365 days', 'Close tabs not used in 365 days'], 'clamped as the field is left');
    await days.fill('');
    await days.press('Tab');
    assert.deepEqual(await shown(), ['365 days', 'Close tabs not used in 365 days'], 'an emptied field keeps its number (it became 1 day)');
    await page.close({ runBeforeUnload: true });
  });
}, [close]);
