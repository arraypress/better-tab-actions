/**
 * Real-browser check of the toolbar glyph: loads extension/ in Playwright's Chromium (Playwright
 * 1.64 from the Tabby repo, as test/e2e/groups.mjs does) and checks that
 *
 * - the background opens its offscreen watcher (reason MATCH_MEDIA) at start, once;
 * - a dark options page (page.emulateMedia) gets the dark glyph, then light the light one;
 * - the offscreen document hears a scheme change on its own (emulated over CDP), with no page open.
 *
 * Chrome has no getter for an action's icon, so the real chrome.action.setIcon is wrapped in the
 * worker: each call is recorded once Chrome has taken it (a path it can't load fails here).
 *
 *   npm run e2e
 */
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { toolbarIcon } from '../../extension/background/toolbar-theme.js';

const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const tmp = await mkdtemp(path.join(tmpdir(), 'mta-toolbar-'));
const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

async function until(fn, what, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Emulate colour schemes in the offscreen document, which Playwright doesn't list as a page: one
 * CDP session attached to it, reused for every change.
 */
async function offscreenEmulator(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((info) => info.url.endsWith('/offscreen/offscreen.html'));
  assert.ok(target, 'the offscreen document is a target');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let id = 0;
  return (scheme) => cdp.send('Target.sendMessageToTarget', {
    sessionId,
    message: JSON.stringify({ id: ++id, method: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'prefers-color-scheme', value: scheme }] } }),
  });
}

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  // 1. The watcher: Chrome has the reason, and the background opened exactly one document.
  assert.equal(await worker.evaluate(() => chrome.offscreen.Reason.MATCH_MEDIA), 'MATCH_MEDIA');
  // Right after creation Chrome can list the document before its address is set: wait for both.
  const offscreen = await until(async () => {
    const found = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
    return found.length && found.every((context) => context.documentUrl?.endsWith('/offscreen/offscreen.html')) && found;
  }, 'the offscreen document');
  assert.equal(offscreen.length, 1);
  assert.equal(offscreen[0].documentUrl, `chrome-extension://${extensionId}/offscreen/offscreen.html`);
  console.log('✔ the background keeps one offscreen document open, for MATCH_MEDIA');

  await worker.evaluate(() => {
    globalThis.iconCalls = [];
    const real = chrome.action.setIcon.bind(chrome.action);
    chrome.action.setIcon = async (details) => {
      await real(details);
      globalThis.iconCalls.push(details.path);
    };
  });
  const calls = () => worker.evaluate(() => globalThis.iconCalls);
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('toolbarDark')).toolbarDark);
  const last = async () => (await calls()).at(-1);

  // The offscreen document follows this machine's real scheme: take it to dark, then light, so
  // every step below starts from a known state (stored light, the document last saw light).
  const blank = await context.newPage();
  const cdp = await context.newCDPSession(blank);
  const emulateOffscreen = await offscreenEmulator(cdp);
  await emulateOffscreen('dark');
  await until(async () => (await stored()) === true, 'the offscreen document to report dark');
  await emulateOffscreen('light');
  await until(async () => (await stored()) === false, 'the offscreen document to report light');

  // 2. The options page, dark then light.
  {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await page.waitForFunction(() => document.getElementById('menu-items').children.length);
    await page.emulateMedia({ colorScheme: 'dark' });
    await until(async () => (await stored()) === true, 'the dark scheme stored');
    assert.deepEqual(await last(), toolbarIcon(true));
    await page.emulateMedia({ colorScheme: 'light' });
    await until(async () => (await stored()) === false, 'the light scheme stored');
    assert.deepEqual(await last(), toolbarIcon(false));
    // Another page in the same scheme sends nothing.
    const before = (await calls()).length;
    const again = await context.newPage();
    await again.emulateMedia({ colorScheme: 'light' });
    await again.goto(`chrome-extension://${extensionId}/options/options.html`);
    await again.waitForFunction(() => document.getElementById('menu-items').children.length);
    await again.waitForTimeout(300);
    assert.equal((await calls()).length, before);
    await again.close();
    // Never in Chrome Sync.
    assert.equal('toolbarDark' in await worker.evaluate(() => chrome.storage.sync.get(null)), false);
    await page.close();
    console.log('✔ a dark options page shows the dark glyph, light the light one, a second light page nothing; toolbarDark stays in local');
  }

  // 3. No page open: the offscreen document alone follows a change.
  {
    for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
    await emulateOffscreen('dark');
    await until(async () => JSON.stringify(await last()) === JSON.stringify(toolbarIcon(true)), 'the dark glyph from the offscreen document');
    await emulateOffscreen('light');
    await until(async () => JSON.stringify(await last()) === JSON.stringify(toolbarIcon(false)), 'the light glyph from the offscreen document');
    await cdp.detach();
    await blank.close();
    console.log('✔ with no page open, the offscreen document swaps the glyph on a scheme change');
  }
} finally {
  await context.close();
  await rm(tmp, { recursive: true, force: true });
}
