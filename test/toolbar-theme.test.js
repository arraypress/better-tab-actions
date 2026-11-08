import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createToolbarTheme, OFFSCREEN_PATH, toolbarIcon, watchFromOffscreen } from '../extension/background/toolbar-theme.js';
import { reportColorScheme, TOOLBAR_DARK_KEY, TOOLBAR_SCHEME } from '../extension/shared/toolbar-scheme.js';
import { loadSettings, saveSettings, DEFAULTS } from '../extension/shared/settings.js';
import { moveSettingsToSync } from '../extension/background/migrate.js';
import { EXTENSION_ID, fakeChromeStorage } from './fake-browser.js';

const self = { id: EXTENSION_ID };
const root = new URL('../extension/', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

/** chrome.action as far as this goes: it remembers the icons it was given. */
function setUp(storage = fakeChromeStorage()) {
  const action = { calls: [], async setIcon({ path }) { this.calls.push(path); } };
  return { storage, action, theme: createToolbarTheme({ storage: storage.local, action, extensionId: EXTENSION_ID }) };
}

/** A MediaQueryList whose answer the test flips, firing `change` as Chrome does. */
function fakeMedia(matches) {
  const media = new EventTarget();
  media.matches = matches;
  media.flip = (next) => { media.matches = next; media.dispatchEvent(new Event('change')); };
  return media;
}

test('toolbar: a dark report stores it and shows the dark glyph; light swaps back', async () => {
  const { storage, action, theme } = setUp();
  theme.onMessage({ type: TOOLBAR_SCHEME, dark: true }, self);
  await theme.settled();
  assert.equal(storage.local.data[TOOLBAR_DARK_KEY], true);
  assert.deepEqual(action.calls, [toolbarIcon(true)]);
  theme.onMessage({ type: TOOLBAR_SCHEME, dark: false }, self);
  await theme.settled();
  assert.equal(storage.local.data[TOOLBAR_DARK_KEY], false);
  assert.deepEqual(action.calls, [toolbarIcon(true), toolbarIcon(false)]);
});

test('toolbar: the same scheme again writes and shows nothing', async () => {
  const { storage, action, theme } = setUp();
  for (const dark of [false, true, true, true]) theme.onMessage({ type: TOOLBAR_SCHEME, dark }, self);
  await theme.settled();
  assert.deepEqual(action.calls, [toolbarIcon(true)]);
  assert.equal(storage.local.writes, 1);
});

test('toolbar: other senders and anything but a boolean are ignored', async () => {
  const { storage, action, theme } = setUp();
  theme.onMessage({ type: TOOLBAR_SCHEME, dark: true }, { id: 'another-extension' });
  theme.onMessage({ type: TOOLBAR_SCHEME, dark: true }, {});
  theme.onMessage({ type: TOOLBAR_SCHEME, dark: 'yes' }, self);
  theme.onMessage({ type: TOOLBAR_SCHEME }, self);
  await theme.settled();
  assert.deepEqual(action.calls, []);
  assert.deepEqual(storage.local.data, {});
  assert.equal(theme.onMessage({ type: 'viewer-action' }, self), false);
});

test('toolbar: a glyph Chrome refuses isn’t stored, so the next report tries again', async () => {
  const { storage, action, theme } = setUp();
  action.setIcon = async () => { throw new Error('Failed to set icon'); };
  const error = console.error;
  console.error = () => {};
  theme.onMessage({ type: TOOLBAR_SCHEME, dark: true }, self);
  await theme.settled();
  console.error = error;
  assert.equal(TOOLBAR_DARK_KEY in storage.local.data, false);
});

test('toolbar: a worker start puts the dark glyph back, and leaves light to the manifest', async () => {
  const dark = setUp(fakeChromeStorage({ local: { [TOOLBAR_DARK_KEY]: true } }));
  await dark.theme.restore();
  assert.deepEqual(dark.action.calls, [toolbarIcon(true)]);
  const light = setUp();
  await light.theme.restore();
  assert.deepEqual(light.action.calls, []);
});

test('toolbar: pages report only when the scheme differs from what’s stored, then on each change', () => {
  const sent = [];
  const media = fakeMedia(false);
  reportColorScheme(media, false, (dark) => sent.push(dark));
  media.flip(true);
  media.flip(true);
  media.flip(false);
  assert.deepEqual(sent, [true, false]);
  // The offscreen document can't read storage: unknown, so it reports once.
  const once = [];
  reportColorScheme(fakeMedia(false), undefined, (dark) => once.push(dark));
  assert.deepEqual(once, [false]);
});

test('toolbar: the offscreen document polls, as no change event reaches a page that never renders', () => {
  const sent = [];
  const media = fakeMedia(false);
  const check = reportColorScheme(media, undefined, (dark) => sent.push(dark));
  media.matches = true; // Chrome updated it, but fired nothing.
  check();
  check();
  assert.deepEqual(sent, [false, true]);
  assert.match(read('offscreen/offscreen.js'), /setInterval\(check, POLL_MS\)/);
});

test('toolbar: the offscreen watcher opens once, for MATCH_MEDIA, even when asked twice at once', async () => {
  const contexts = [];
  const offscreen = {
    Reason: { MATCH_MEDIA: 'MATCH_MEDIA' },
    created: [],
    async createDocument(options) {
      if (contexts.length) throw new Error('Only a single offscreen document may be created.');
      this.created.push(options);
      contexts.push({ contextType: 'OFFSCREEN_DOCUMENT' });
    },
  };
  const runtime = { async getContexts() { return [...contexts]; } };
  assert.deepEqual(await Promise.all([watchFromOffscreen({ offscreen, runtime }), watchFromOffscreen({ offscreen, runtime })]), [true, true]);
  assert.equal(await watchFromOffscreen({ offscreen, runtime }), false);
  assert.equal(offscreen.created.length, 1);
  assert.deepEqual(offscreen.created[0].reasons, ['MATCH_MEDIA']);
  assert.equal(offscreen.created[0].url, OFFSCREEN_PATH);
});

test('toolbar: manifest starts on the light glyph, keeps its brand icons, asks for offscreen; every file ships', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const fromRoot = (icon) => Object.fromEntries(Object.entries(icon).map(([size, file]) => [size, file.slice(1)]));
  assert.deepEqual(manifest.action.default_icon, fromRoot(toolbarIcon(false)));
  assert.equal(manifest.icons['128'], 'icons/icon-128.png');
  assert.ok(manifest.permissions.includes('offscreen'));
  for (const file of [...Object.values(toolbarIcon(false)), ...Object.values(toolbarIcon(true))]) {
    assert.ok(existsSync(new URL(file.slice(1), root)), file);
  }
  // Everything under extension/ ships (test/package.test.js); OFFSCREEN_PATH is from the extension's root.
  for (const file of ['shared/toolbar-scheme.js', 'background/toolbar-theme.js', OFFSCREEN_PATH, 'offscreen/offscreen.js']) {
    assert.ok(existsSync(new URL(file, root)), file);
  }
  assert.match(read('options/options.js'), /watchColorScheme\(\)/);
});

test('toolbarDark: this computer’s, never synced (saving, loading and the move to sync leave it in local)', async () => {
  const storage = fakeChromeStorage({ local: { [TOOLBAR_DARK_KEY]: true, inactiveDays: 21 } });
  await moveSettingsToSync(storage);
  await saveSettings(storage, { windowScope: 'all' });
  assert.equal(TOOLBAR_DARK_KEY in storage.sync.data, false);
  assert.equal(storage.local.data[TOOLBAR_DARK_KEY], true);
  assert.deepEqual(await loadSettings(storage), { ...DEFAULTS, inactiveDays: 21, windowScope: 'all' });
  // Nothing settings-shaped mentions it either.
  assert.doesNotMatch(read('shared/settings.js'), /toolbarDark/);
});
