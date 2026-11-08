/**
 * Real-browser check of the two group actions: loads extension/ as an unpacked extension in
 * Playwright's Chromium and runs the actions through the background's own handler (`runMenuAction`, what the menu
 * and shortcuts call), so the real chrome.tabs / chrome.tabGroups / chrome.windows do the work.
 *
 *   npm run e2e
 *
 * Not run by `npm test` (it launches a browser). What it can't see: Chrome's saved groups. No
 * extension API lists them and their UI is native, so "the group stays saved after its window
 * closes" rests on Chromium's source (see actions.js) and a check by hand in real Chrome.
 *
 * @module test/e2e/groups
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchExtension } from '@arraypress/extension-kit/testing';

/**
 * The service worker's global scope: the background's `runMenuAction` (what the menu and
 * shortcuts call), and the groups this check saw Chrome update.
 *
 * @typedef {typeof globalThis & {
 *   runMenuAction: (id: string, tab: chrome.tabs.Tab) => Promise<number[]>,
 *   seenGroups: {windowId: number, title?: string}[],
 * }} WorkerScope
 */

const extension = fileURLToPath(new URL('../../extension', import.meta.url));
const { context, worker, close } = await launchExtension(chromium, extension, { prefix: 'mta-e2e-', locale: 'en-GB' });

try {
  // Made-up sites, answered locally (the network edge).
  await context.route('https://*.example/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<title>${new URL(route.request().url()).hostname}</title>` }));

  /**
   * Open a window with these tabs and wait for them to load.
   *
   * @param {string[]} urls - The tabs' addresses.
   * @param {number[]} [pin] - Indexes of the tabs to pin.
   */
  const openWindow = (urls, pin = []) => worker.evaluate(async ({ urls, pin }) => {
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
   * Run an action on a tab exactly as a menu click does.
   *
   * @param {string} id - The action.
   * @param {number} tabId - The clicked tab.
   */
  const click = (id, tabId) => worker.evaluate(async ({ id, tabId }) =>
    /** @type {WorkerScope} */ (globalThis).runMenuAction(id, await chrome.tabs.get(tabId)), { id, tabId });

  /**
   * A window's groups (title and addresses) and its ungrouped tabs ("pinned " marks pinned ones).
   *
   * @param {number} windowId - The window.
   */
  const windowState = (windowId) => worker.evaluate(async (windowId) => {
    const tabs = await chrome.tabs.query({ windowId });
    const groups = await chrome.tabGroups.query({ windowId });
    return {
      groups: groups.map((g) => ({ title: g.title, urls: tabs.filter((t) => t.groupId === g.id).map((t) => t.url) })),
      ungrouped: tabs.filter((t) => t.groupId === -1).map((t) => `${t.pinned ? 'pinned ' : ''}${t.url}`),
    };
  }, windowId);

  // 1. "Save this window as a group": 4 tabs, 2 on one site, in a window that isn't focused.
  {
    const urls = ['https://github.example/a', 'https://news.example/', 'https://github.example/b', 'https://docs.example/'];
    const { windowId, tabIds } = await openWindow(urls);
    const grouped = await click('save-window-as-group', tabIds[1]);
    assert.deepEqual(grouped.sort(), [...tabIds].sort());
    assert.deepEqual(await windowState(windowId), { groups: [{ title: 'github.example', urls }], ungrouped: [] });
    // Run again: nothing left to group, so nothing changes.
    assert.deepEqual(await click('save-window-as-group', tabIds[0]), []);
    assert.equal((await windowState(windowId)).groups.length, 1);
    console.log('✔ save-window-as-group: one group, named github.example, with the window’s 4 tabs');
  }

  // 2. Pinned tabs stay pinned and out of the group; "Close window and keep as group" won't close it.
  {
    const urls = ['https://mail.example/', 'https://a.example/', 'https://b.example/'];
    const { windowId, tabIds } = await openWindow(urls, [0]);
    assert.deepEqual(await click('close-window-keep-group', tabIds[1]), []);
    assert.deepEqual(await windowState(windowId), { groups: [], ungrouped: ['pinned https://mail.example/', ...urls.slice(1)] });
    await click('save-window-as-group', tabIds[1]);
    const state = await windowState(windowId);
    assert.deepEqual(state.ungrouped, ['pinned https://mail.example/']);
    assert.equal(state.groups[0].title, new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date()));
    console.log(`✔ pinned tab left alone; tie named by date (“${state.groups[0].title}”); close action declined while pinned`);
  }

  // 3. "Close window and keep as group": the group is made and named, then the window closes.
  {
    const urls = ['https://shop.example/1', 'https://shop.example/2', 'https://c.example/'];
    const { windowId, tabIds } = await openWindow(urls);
    await worker.evaluate(() => {
      const scope = /** @type {WorkerScope} */ (globalThis);
      scope.seenGroups = [];
      chrome.tabGroups.onUpdated.addListener((g) => scope.seenGroups.push({ windowId: g.windowId, title: g.title }));
    });
    assert.deepEqual((await click('close-window-keep-group', tabIds[0])).sort(), [...tabIds].sort());
    const windows = await worker.evaluate(() => chrome.windows.getAll().then((all) => all.map((w) => w.id)));
    assert.ok(!windows.includes(windowId), 'the window is closed');
    const seen = await worker.evaluate(() => /** @type {WorkerScope} */ (globalThis).seenGroups);
    assert.ok(seen.some((g) => g.windowId === windowId && g.title === 'shop.example'), `group named before closing: ${JSON.stringify(seen)}`);
    console.log('✔ close-window-keep-group: grouped as “shop.example”, then the window closed');
    console.log('– not checkable here: that Chrome lists it in saved groups (no API exposes them)');
  }
} finally {
  await close();
}
