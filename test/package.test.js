/**
 * The store zip is exactly extension/, less source-only files; every path the extension names
 * resolves inside it; and the manifest ships no default keyboard shortcut and no test hook.
 *
 * @module test/package
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { shipsFile } from '@arraypress/extension-kit/build';
import { filesUnder, missingReferences, zipEntries } from '@arraypress/extension-kit/testing';
import { OFFSCREEN_PATH } from '../extension/vendor/extension-kit/index.js';

const extension = fileURLToPath(new URL('../extension/', import.meta.url));

test('package: the zip is exactly extension/, less the SVG sources and declarations, with manifest.json at its root', async () => {
  const files = await filesUnder(extension);
  const entries = await zipEntries(extension);
  assert.deepEqual(entries, files.filter(shipsFile));
  assert.ok(entries.includes('manifest.json'));
  assert.ok(entries.includes('vendor/extension-kit/styles/chrome-ui.css'), 'the kit ships inside the extension');
  assert.ok(files.some((file) => file.endsWith('.svg')), 'the SVG sources are in extension/ to be left out');
  assert.ok(!entries.some((entry) => entry.endsWith('.svg') || entry.endsWith('.d.ts') || entry.endsWith('/')));
});

test('package: .DS_Store files anywhere in extension/ are left out', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'mta-copy-'));
  try {
    const copy = path.join(tmp, 'extension');
    await cp(extension, copy, { recursive: true });
    await writeFile(path.join(copy, '.DS_Store'), 'x');
    await writeFile(path.join(copy, 'options', '.DS_Store'), 'x');
    const entries = await zipEntries(copy);
    assert.ok(!entries.some((entry) => entry.endsWith('.DS_Store')));
    assert.deepEqual(entries, (await filesUnder(extension)).filter(shipsFile));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('package: every path the extension names resolves to a file inside extension/', async () => {
  assert.deepEqual(await missingReferences(extension, [OFFSCREEN_PATH]), []);
});

test('manifest: no command has a default key (people set their own at chrome://extensions/shortcuts)', async () => {
  // Alt+Shift+letter types a character on a Mac and switches the keyboard's language on Windows.
  const { commands } = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert.ok(Object.keys(commands).length > 0, 'the commands stay, so keys can be set');
  for (const [name, command] of Object.entries(commands)) {
    assert.equal(/** @type {{suggested_key?: unknown}} */ (command).suggested_key, undefined, name);
    assert.ok(/** @type {{description?: string}} */ (command).description, `${name} has a description for Chrome’s shortcuts page`);
  }
});

test('the store build has no test hook: the worker is background.js and puts nothing on its global scope', async () => {
  const { background } = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert.equal(background.service_worker, 'background/background.js');
  for (const file of (await filesUnder(extension)).filter((name) => name.endsWith('.js') && !name.startsWith('vendor/'))) {
    assert.doesNotMatch(await readFile(path.join(extension, file), 'utf8'), /globalThis/, file);
  }
});
