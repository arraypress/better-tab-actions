/**
 * What the e2e checks share: the test build (extension/ plus the test hook, scripts/build-e2e.mjs)
 * in a fresh profile, made-up sites answered by a local server (the network edge) that counts
 * each request, opening a window of tabs from the service worker, and a menu click or keyboard
 * shortcut made through the hook.
 *
 * @module test/e2e/helpers
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { extensionProfile, serve, testBuildDir, testCertificate } from '@arraypress/extension-kit/testing';

/** @import { Worker } from 'playwright' */
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

/** How long `https://slow.example/` pages take to answer. */
export const SLOW_MS = 3000;

/**
 * A real local web server standing in for every `https://<name>.example/` site (the network
 * edge): each page is a small one titled with its host, and every request that reaches the
 * server is counted. `slow.example` answers after {@link SLOW_MS}.
 *
 * The count is the server's own. Playwright's `context.route` doesn't see the requests of tabs an
 * extension opens in the background, so a count made there says "no request" for tabs that
 * asked for their pages.
 *
 * @returns {Promise<{hits: Map<string, number>, args: string[], close(): Promise<void>}>} Address →
 *   requests so far (live), the Chromium switches that send `*.example` to the server, and its end.
 */
async function serveExampleSites() {
  /** @type {Map<string, number>} */
  const hits = new Map();
  const site = await serve(async (pathname, request) => {
    const host = (request.headers.host ?? '').split(':')[0];
    if (pathname === '/favicon.ico') return undefined;
    const url = `https://${host}${request.url}`;
    hits.set(url, (hits.get(url) ?? 0) + 1);
    if (host === 'slow.example') await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    return { body: `<title>${host}</title>`, headers: { 'Cache-Control': 'no-store' } };
  }, { tls: testCertificate() });
  return {
    hits,
    args: [`--host-resolver-rules=MAP *.example 127.0.0.1:${site.port}`, '--ignore-certificate-errors'],
    close: site.close,
  };
}

/**
 * A fresh en-GB profile for the extension in Playwright's Chromium, to start once or more (Chrome's
 * saved groups can only be read once it has closed), with the made-up `*.example` sites answered
 * by a local server ({@link serveExampleSites}).
 *
 * @param {string} prefix - The temporary profile's name prefix.
 * @param {string} [dir] - The unpacked extension. Default {@link BUILD}.
 * @returns {Promise<Awaited<ReturnType<typeof extensionProfile>> & {hits: Map<string, number>}>} The
 *   profile, and the requests the sites have had: address → how many (live). `remove` also stops the server.
 */
export async function testProfile(prefix, dir = BUILD) {
  const sites = await serveExampleSites();
  const profile = await extensionProfile(chromium, dir, { prefix, locale: 'en-GB', args: sites.args });
  return {
    ...profile,
    hits: sites.hits,
    async remove() {
      await sites.close();
      await profile.remove();
    },
  };
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
