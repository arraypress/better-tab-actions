/**
 * Real-browser check of the two group actions: loads extension/ as an unpacked extension in
 * Playwright's Chromium and runs the actions through the background's own handler (`runMenuAction`, what the menu
 * and shortcuts call), so the real chrome.tabs / chrome.tabGroups / chrome.windows do the work.
 *
 *   npm run e2e
 *
 * Not run by `npm test` (it launches a browser). Chrome's saved groups have no extension API and
 * native UI, so "the group stays saved after its window closes" is read from the closed profile's
 * store (saved-groups.mjs).
 *
 * @module test/e2e/groups
 */
import assert from 'node:assert/strict';
import { click as clickOn, openWindow as openIn, serveExampleSites, testProfile } from './helpers.mjs';
import { savedGroups } from './saved-groups.mjs';

/**
 * The service worker's global scope, with the groups this check saw Chrome update.
 *
 * @typedef {import('./helpers.mjs').WorkerScope & {seenGroups: {windowId: number, title?: string}[]}} WorkerScope
 */

const profile = await testProfile('mta-e2e-');
const { context, worker, close } = await profile.launch();

try {
  // Made-up sites, answered locally (the network edge).
  await serveExampleSites(context);
  /** @param {string[]} urls @param {number[]} [pin] */
  const openWindow = (urls, pin) => openIn(worker, urls, pin);
  /** @param {string} id @param {number} tabId */
  const click = (id, tabId) => clickOn(worker, id, tabId);

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
  }

  // 4. Chrome keeps the closed window's group in its saved groups (read from the closed profile).
  await close();
  const shop = (await savedGroups(profile.dir)).filter((g) => g.title === 'shop.example');
  assert.deepEqual(shop.map((g) => g.urls), [['https://shop.example/1', 'https://shop.example/2', 'https://c.example/']]);
  console.log('✔ Chrome keeps “shop.example” in its saved tab groups after the window closed');
} finally {
  await close().catch(() => {});
  await profile.remove();
}
