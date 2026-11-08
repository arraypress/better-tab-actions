// The store zip is exactly extension/, less source-only files, and every path the extension
// names resolves inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
