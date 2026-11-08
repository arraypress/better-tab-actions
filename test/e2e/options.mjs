/**
 * Real-browser check of the options page: loads extension/ as an unpacked extension in
 * Playwright's Chromium and drives
 * the real page against real chrome.storage.
 *
 *   npm run e2e
 *
 * Checks: settings are written to Chrome Sync, a burst of clicks is one write, a change still
 * waiting is written as the page closes, the background's menu follows, there's no sync switch,
 * and the About card shows the manifest's version and the links from about-links.js.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchExtension, until } from '@arraypress/extension-kit/testing';
import { ABOUT_LINKS } from '../../extension/options/about-links.js';

const extension = fileURLToPath(new URL('../../extension', import.meta.url));
const { context, worker, url, close } = await launchExtension(chromium, extension, { prefix: 'mta-e2e-' });

try {
  // Local holds only what's this computer's: the toolbar glyph's scheme (toolbar-theme.js) aside, nothing.
  const stored = () => worker.evaluate(async () => {
    const { toolbarDark, ...local } = await chrome.storage.local.get(null);
    return { sync: await chrome.storage.sync.get(null), local };
  });
  await worker.evaluate(() => {
    globalThis.syncWrites = 0;
    chrome.storage.sync.onChanged.addListener(() => { globalThis.syncWrites++; });
  });
  const open = async () => {
    const page = await context.newPage();
    await page.goto(url('options/options.html'));
    await page.waitForFunction(() => document.getElementById('menu-items').children.length);
    return page;
  };

  // 1. The page: no sync switch; the About card last, as chrome://settings/help.
  {
    const page = await open();
    const text = await page.locator('main').innerText();
    assert.equal(await page.locator('#syncSettings').count(), 0);
    assert.doesNotMatch(text, /Sync settings/);
    const { version } = JSON.parse(await readFile(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
    assert.equal(await page.locator('#version').innerText(), `Version ${version}`);
    assert.match(text, /About More Tab Actions\s+More Tab Actions\s+Version [\d.]+\s+Get help with More Tab Actions\s+Report an issue\s+Privacy policy\s*$/);
    assert.equal(await page.locator('#help').getAttribute('href'), ABOUT_LINKS.help);
    assert.equal(await page.locator('#report-issue').getAttribute('href'), ABOUT_LINKS.reportIssue);
    assert.equal(await page.locator('#privacy-policy').getAttribute('href'), ABOUT_LINKS.privacyPolicy);
    await page.close();
    console.log(`✔ no sync switch; About card shows Version ${version} and the configured links`);
  }

  // 2. A burst of clicks is one write to Chrome Sync, after the clicks stop; the menu follows.
  {
    const page = await open();
    const grouped = page.locator('#includeGroupedTabs');
    for (let i = 0; i < 9; i++) await grouped.click(); // Ends off.
    await page.locator('#windowScope').selectOption('all');
    await page.locator('#inactiveDays').fill('30');
    await page.locator('#inactiveDays').dispatchEvent('change');
    assert.equal(await worker.evaluate(() => globalThis.syncWrites), 0, 'nothing written mid-burst');
    await until(async () => (await stored()).sync.inactiveDays === 30, 'the settings to reach sync');
    await page.waitForTimeout(1500);
    assert.equal(await worker.evaluate(() => globalThis.syncWrites), 1);
    assert.deepEqual(await stored(), { sync: { includeGroupedTabs: false, windowScope: 'all', inactiveDays: 30 }, local: {} });
    // The background rebuilt the menu from sync: the inactive item names the new days.
    await until(() => worker.evaluate(() => new Promise((resolve) =>
      chrome.contextMenus.update('close-inactive-tabs', { title: 'Close tabs not used in 30 days' }, () => resolve(!chrome.runtime.lastError)))), 'the menu');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('inactiveDays').value === '30');
    assert.equal(await grouped.isChecked(), false);
    await page.close();
    console.log('✔ eleven quick changes made one sync write; the page and menu read them back from sync');
  }

  // 3. Closing the page writes a change still waiting.
  {
    const page = await open();
    await page.locator('#windowScope').selectOption('window');
    await page.close({ runBeforeUnload: true });
    await until(async () => (await stored()).sync.windowScope === 'window', 'the change to reach sync');
    console.log('✔ a change still waiting is written as the page closes');
  }
} finally {
  await close();
}
