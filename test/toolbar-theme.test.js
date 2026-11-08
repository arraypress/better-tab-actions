// How More Tab Actions wires the light/dark toolbar glyph. The theme itself (reports, the
// offscreen watcher) is tested in @arraypress/extension-kit; test/e2e/toolbar.mjs runs it in Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fakeChromeStorage } from '@arraypress/extension-kit/testing';
import { OFFSCREEN_PATH, TOOLBAR_DARK_KEY, toolbarIcon } from '../extension/vendor/extension-kit/index.js';
import { DEFAULTS, settingsStore } from '../extension/shared/settings.js';

const root = new URL('../extension/', import.meta.url);
/** @param {string} file */
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('manifest starts on the light glyph, keeps its brand icons, asks for offscreen; every glyph exists', () => {
  const manifest = JSON.parse(read('manifest.json'));
  /** @param {Record<string, string>} icon */
  const fromRoot = (icon) => Object.fromEntries(Object.entries(icon).map(([size, file]) => [size, file.slice(1)]));
  assert.deepEqual(manifest.action.default_icon, fromRoot(toolbarIcon(false)));
  assert.equal(manifest.icons['128'], 'icons/icon-128.png');
  assert.ok(manifest.permissions.includes('offscreen'));
  for (const file of [...Object.values(toolbarIcon(false)), ...Object.values(toolbarIcon(true))]) {
    assert.ok(existsSync(new URL(file.slice(1), root)), file);
  }
  assert.ok(existsSync(new URL(OFFSCREEN_PATH, root)));
});

test('the worker starts the theme, the offscreen document watches, the options page reports', () => {
  assert.match(read('background/background.js'), /startToolbarTheme\(chrome\)/);
  assert.match(read('offscreen/offscreen.js'), /watchSchemeOffscreen\(chrome\.runtime\)/);
  assert.match(read('options/options.js'), /watchColorScheme\(chrome\)/);
});

test('toolbarDark: this computer’s, never synced (saving and loading leave it in local)', async () => {
  const storage = fakeChromeStorage({ local: { [TOOLBAR_DARK_KEY]: true } });
  await settingsStore.save(storage, { windowScope: 'all' });
  assert.equal(TOOLBAR_DARK_KEY in storage.sync.data, false);
  assert.equal(storage.local.data[TOOLBAR_DARK_KEY], true);
  assert.deepEqual(await settingsStore.load(storage), { ...DEFAULTS, windowScope: 'all' });
});
