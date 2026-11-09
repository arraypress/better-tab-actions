/**
 * What the e2e checks share: made-up sites answered locally (the network edge), counting each
 * request; opening a window of tabs from the service worker; and running an action the way a
 * menu click does.
 *
 * @module test/e2e/helpers
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { extensionProfile } from '@arraypress/extension-kit/testing';

/** @import { BrowserContext, Worker } from 'playwright' */

/**
 * The service worker's global scope: the background's `runMenuAction`, what the menu and
 * shortcuts call.
 *
 * @typedef {typeof globalThis & {
 *   runMenuAction: (id: string, tab?: chrome.tabs.Tab, workspaceId?: string) => Promise<number[]>,
 * }} WorkerScope
 */

/** The unpacked extension. */
export const EXTENSION = fileURLToPath(new URL('../../extension', import.meta.url));

/**
 * A fresh en-GB profile for the extension in Playwright's Chromium, to start once or more (Chrome's
 * saved groups can only be read once it has closed).
 *
 * @param {string} prefix - The temporary profile's name prefix.
 * @returns {ReturnType<typeof extensionProfile>} The profile.
 */
export const testProfile = (prefix) => extensionProfile(chromium, EXTENSION, { prefix, locale: 'en-GB' });

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
 * Run an action exactly as a menu click (with a tab) or a keyboard shortcut (without) does.
 *
 * @param {Worker} worker - The extension's service worker.
 * @param {string} id - The action.
 * @param {number} [tabId] - The clicked tab.
 * @param {string} [workspaceId] - For "open-workspace", the submenu item's workspace.
 * @returns {Promise<number[]>} What the action acted on.
 */
export const click = (worker, id, tabId, workspaceId) => worker.evaluate(async ({ id, tabId, workspaceId }) =>
  /** @type {WorkerScope} */ (globalThis).runMenuAction(id, tabId === undefined ? undefined : await chrome.tabs.get(tabId), workspaceId),
{ id, tabId, workspaceId });
