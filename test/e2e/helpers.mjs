/**
 * What the e2e checks share: the test build (extension/ plus the test hook, scripts/build-e2e.mjs)
 * in a fresh profile, made-up sites answered locally (the network edge) with each request
 * counted, opening a window of tabs from the service worker, and a menu click or keyboard
 * shortcut made through the hook.
 *
 * @module test/e2e/helpers
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { extensionProfile, testBuildDir } from '@arraypress/extension-kit/testing';

/** @import { BrowserContext, Worker } from 'playwright' */
/** @import { TestHook } from './hook.js' */

/**
 * A test build's service worker scope: the hook's handlers.
 *
 * @typedef {typeof globalThis & {betterTabActionsTest: TestHook}} HookScope
 */

const root = fileURLToPath(new URL('../..', import.meta.url));
/** The unpacked extension, as the store gets it. */
export const EXTENSION = fileURLToPath(new URL('../../extension', import.meta.url));
/** The test build: extension/ with the test hook as its service worker (`npm run e2e` builds it first). */
export const BUILD = testBuildDir(root);

/**
 * A fresh en-GB profile for the extension in Playwright's Chromium, to start once or more (Chrome's
 * saved groups can only be read once it has closed).
 *
 * @param {string} prefix - The temporary profile's name prefix.
 * @param {string} [dir] - The unpacked extension. Default {@link BUILD}.
 * @returns {ReturnType<typeof extensionProfile>} The profile.
 */
export const testProfile = (prefix, dir = BUILD) => extensionProfile(chromium, dir, { prefix, locale: 'en-GB' });

/**
 * Answer every `https://<name>.example/` page with a small page titled with its host, and count
 * the requests per address.
 *
 * @param {BrowserContext} context - The browser.
 * @returns {Promise<Map<string, number>>} Address → requests so far (live).
 */
export async function serveExampleSites(context) {
  /** @type {Map<string, number>} */
  const hits = new Map();
  await context.route('https://*.example/**', (route) => {
    const url = route.request().url();
    hits.set(url, (hits.get(url) ?? 0) + 1);
    return route.fulfill({ contentType: 'text/html', body: `<title>${new URL(url).hostname}</title>` });
  });
  return hits;
}

/**
 * Open a window with these tabs, pin some, and wait for them to load.
 *
 * @param {Worker} worker - The extension's service worker.
 * @param {string[]} urls - The tabs' addresses.
 * @param {number[]} [pin] - Indexes of the tabs to pin.
 * @returns {Promise<{windowId: number, tabIds: number[]}>} The window and its tabs, in order.
 */
export const openWindow = (worker, urls, pin = []) => worker.evaluate(async ({ urls, pin }) => {
  const win = await chrome.windows.create({ url: urls, focused: false });
  if (win?.id === undefined || !win.tabs) throw new Error('Chrome opened no window');
  const { id: windowId, tabs: opened } = win;
  for (const i of pin) await chrome.tabs.update(opened[i].id, { pinned: true });
  for (let n = 0; n < 50; n++) {
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.every((tab) => tab.status === 'complete' && tab.url)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { windowId, tabIds: opened.flatMap((tab) => tab.id ?? []) };
}, { urls, pin });

/**
 * Click an item of the tab menu on a tab, through the test hook: exactly what Chrome's
 * `contextMenus.onClicked` listener calls.
 *
 * @param {Worker} worker - A test build's service worker.
 * @param {string} menuItemId - The item: an action, `open-workspace:<id>` or `manage-workspaces`.
 * @param {number} tabId - The right-clicked tab.
 * @returns {Promise<number[]>} What the action acted on.
 */
export const click = (worker, menuItemId, tabId) => worker.evaluate(async ({ menuItemId, tabId }) =>
  /** @type {HookScope} */ (globalThis).betterTabActionsTest.click({ menuItemId }, await chrome.tabs.get(tabId)),
{ menuItemId, tabId });

/**
 * Press a command's keyboard shortcut, through the test hook: exactly what Chrome's
 * `commands.onCommand` listener calls, with the tab Chrome names (the active one).
 *
 * @param {Worker} worker - A test build's service worker.
 * @param {string} command - The command's name in the manifest.
 * @param {number} [tabId] - The tab in front. Default: the last focused window's active tab.
 * @returns {Promise<number[]>} What the action acted on.
 */
export const press = (worker, command, tabId) => worker.evaluate(async ({ command, tabId }) => {
  const tab = tabId === undefined ? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] : await chrome.tabs.get(tabId);
  return /** @type {HookScope} */ (globalThis).betterTabActionsTest.command(command, tab);
}, { command, tabId });
