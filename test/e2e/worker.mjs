/**
 * Real-browser check of the service worker's lifetime and the keyboard shortcuts: the test build
 * in Playwright's Chromium, with the worker stopped as Chrome stops it after 30 idle seconds (the
 * kit's `stopWorker`; Playwright's debugger otherwise keeps it alive for the whole run).
 *
 *   npm run e2e
 *
 * 1. No command has a key until a person sets one; a command still runs its action.
 * 2. Chrome keeps the menu's items while the worker is stopped.
 * 3. The closed batch outlives the worker: "Reopen closed tabs" brings the tabs back afterwards.
 * 4. The recent tabs outlive it too: "Switch to last used tab" goes back and forth across a stop.
 * 5. So does automatic closing's alarm, which a worker starting again leaves as it is.
 *
 * @module test/e2e/worker
 */
import assert from 'node:assert/strict';
import { checkRunner, runChecks, stopWorker, until } from '@arraypress/extension-kit/testing';
import { ACTIONS, SWITCH_LAST } from '../../extension/shared/actions.js';
import { click, openWindow, press, serveExampleSites, testProfile } from './helpers.mjs';

const profile = await testProfile('bta-worker-');
const launched = await profile.launch();
const { context, worker, close } = launched;
const runner = checkRunner();
const { check } = runner;

/**
 * A window's tabs' addresses, in order.
 *
 * @param {number} windowId - The window.
 * @returns {Promise<string[]>} Their addresses.
 */
const strip = (windowId) => worker.evaluate(async (windowId) => (await chrome.tabs.query({ windowId })).map((tab) => tab.url || tab.pendingUrl || ''), windowId);

/**
 * Whether Chrome holds a menu item (it refuses to update one it doesn't; there's no way to list them).
 *
 * @param {string} id - The item.
 * @returns {Promise<boolean>} True when it's in the menu.
 */
const inMenu = (id) => worker.evaluate((id) => chrome.contextMenus.update(id, {}).then(() => true, () => false), id);

await runChecks(runner, async () => {
  await serveExampleSites(context);
  const urls = ['https://a.example/1', 'https://b.example/', 'https://a.example/2', 'https://c.example/'];
  const { windowId, tabIds } = await openWindow(worker, urls);

  await check('no command has a keyboard shortcut until a person sets one; every command is there to set', async () => {
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    assert.deepEqual(commands.filter((command) => command.shortcut), []);
    const names = commands.map((command) => command.name);
    for (const id of [SWITCH_LAST, ...ACTIONS.map((action) => action.id)]) assert.ok(names.includes(id), id);
  });

  await check('a command runs its action on the tab in front: “Close tabs from this site”', async () => {
    assert.deepEqual((await press(worker, 'close-site-tabs', tabIds[0])).sort(), [tabIds[0], tabIds[2]].sort());
    assert.deepEqual(await strip(windowId), [urls[1], urls[3]]);
  });

  await check('Chrome keeps the menu while the worker is stopped, and the closed batch outlives it: “Reopen closed tabs” puts both tabs back', async () => {
    await until(() => inMenu('reopen-closed-tabs'), 'the menu');
    await stopWorker(launched);
    assert.equal(await inMenu('more-tab-actions'), true);
    assert.equal(await inMenu('reopen-closed-tabs'), true);
    assert.equal((await click(worker, 'reopen-closed-tabs', tabIds[1])).length, 2);
    await until(async () => (await strip(windowId)).join() === urls.join(), 'the closed tabs back in their places');
  });

  await check('the recent tabs outlive the worker: “Switch to last used tab” goes back to the tab used before, and back again', async () => {
    const [, second, , fourth] = tabIds;
    /** The stored recent tabs, most recent first. */
    const recent = () => worker.evaluate(async () => /** @type {number[]} */ ((await chrome.storage.session.get('recentTabs')).recentTabs ?? []));
    // The person clicks the second tab, then the fourth (whichever was in front: activating the tab in front tells nobody).
    await worker.evaluate(async (order) => {
      for (const id of order) await chrome.tabs.update(id, { active: true });
    }, [fourth, second, fourth]);
    await until(async () => (await recent()).slice(0, 2).join() === [fourth, second].join(), 'the recent tabs to be stored');

    await stopWorker(launched);
    // stopWorker opened and closed a page of its own, so another window's tab came to the front
    // last (once the new worker has heard of both); under it, the list is as it was stored
    // before the worker stopped.
    const [front, ...earlier] = await until(async () => {
      const list = await recent();
      return (await worker.evaluate((id) => chrome.tabs.get(id ?? -1).then(() => true, () => false), list[0])) && list[0] !== fourth && list;
    }, 'the tab that came to the front');
    assert.deepEqual(earlier.slice(0, 2), [fourth, second]);
    assert.deepEqual(await press(worker, SWITCH_LAST, front), [fourth]);
    assert.deepEqual(await press(worker, SWITCH_LAST, fourth), [front], 'pressed again, it goes back');
    assert.deepEqual(await press(worker, SWITCH_LAST, front), [fourth]);
  });

  await check('automatic closing’s alarm outlives the worker, and the worker starting again doesn’t push the next check back', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ autoClose: true }));
    const alarm = await until(() => worker.evaluate(() => chrome.alarms.get('close-unused-tabs')), 'the alarm');
    assert.equal(alarm.periodInMinutes, 5);
    await stopWorker(launched);
    // A settings change makes the new worker look at the schedule again: it leaves a running alarm alone.
    await worker.evaluate(() => chrome.storage.sync.set({ autoCloseHours: 24 }));
    await until(() => worker.evaluate(() => chrome.contextMenus.update('close-site-tabs', {}).then(() => true, () => false)), 'the menu to be rebuilt');
    assert.deepEqual(await worker.evaluate(() => chrome.alarms.get('close-unused-tabs')), alarm);
  });
}, [close, profile.remove]);
