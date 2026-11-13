/**
 * Real-browser check of the toolbar glyph: loads extension/ in Playwright's Chromium and runs
 * @arraypress/extension-kit's `checkToolbarTheme`: the offscreen watcher opens once for
 * MATCH_MEDIA, the options page swaps the glyph dark and light, and the offscreen document alone
 * follows a change with no page open.
 *
 *   npm run e2e
 *
 * @module test/e2e/toolbar
 */
import { chromium } from 'playwright';
import { checkToolbarTheme, launchExtension } from '@arraypress/extension-kit/testing';
import { toolbarIcon } from '../../extension/vendor/extension-kit/index.js';
import { EXTENSION } from './helpers.mjs';

const launched = await launchExtension(chromium, EXTENSION, { prefix: 'bta-toolbar-' });
try {
  const options = {
    path: 'options/options.html',
    ready: (/** @type {import('playwright').Page} */ page) => page.waitForFunction(() => document.getElementById('menu-items')?.children.length),
  };
  await checkToolbarTheme(launched, [options], { light: toolbarIcon(false), dark: toolbarIcon(true) });
} finally {
  await launched.close();
}
