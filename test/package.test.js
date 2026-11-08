import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EXTENSION, zipExtension } from '../scripts/package.mjs';

const extension = fileURLToPath(new URL('../extension/', import.meta.url));

/** Every file under `dir`, as paths relative to it with forward slashes. */
async function filesUnder(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

/** What ships: everything but the icons' SVG sources and Finder's .DS_Store files. */
const ships = (file) => !/^icons\/.*\.svg$/.test(file) && path.posix.basename(file) !== '.DS_Store';

/** The real zip (scripts/package.mjs) of `from`, listed by unzip. */
async function zipped(from) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'mta-zip-'));
  try {
    const zip = await zipExtension(from, path.join(tmp, 'out.zip'));
    return execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').sort();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

test('package: the zip is exactly extension/, less the SVG sources, with manifest.json at its root', async () => {
  assert.equal(path.resolve(EXTENSION), path.resolve(extension));
  const files = await filesUnder(extension);
  const entries = await zipped(extension);
  assert.deepEqual(entries, files.filter(ships));
  assert.ok(entries.includes('manifest.json'));
  assert.ok(files.some((file) => file.endsWith('.svg')), 'the SVG sources are in extension/ to be left out');
  assert.ok(!entries.some((entry) => entry.endsWith('.svg') || entry.endsWith('/')));
});

test('package: .DS_Store files anywhere in extension/ are left out', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'mta-copy-'));
  try {
    const copy = path.join(tmp, 'extension');
    await cp(extension, copy, { recursive: true });
    await writeFile(path.join(copy, '.DS_Store'), 'x');
    await writeFile(path.join(copy, 'options', '.DS_Store'), 'x');
    const entries = await zipped(copy);
    assert.ok(!entries.some((entry) => entry.endsWith('.DS_Store')));
    assert.deepEqual(entries, (await filesUnder(extension)).filter(ships));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('package: every path the extension names resolves to a file inside extension/', async () => {
  const files = await filesUnder(extension);
  const missing = [];
  const check = (from, target) => {
    const file = path.resolve(extension, from, target);
    if (!file.startsWith(extension) || !existsSync(file)) missing.push(`${from || 'manifest'} → ${target}`);
  };
  for (const file of files) {
    const dir = path.posix.dirname(file);
    if (file.endsWith('.js')) {
      const src = await readFile(path.join(extension, file), 'utf8');
      for (const [, spec] of src.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) check(dir, spec);
    } else if (file.endsWith('.html')) {
      const src = await readFile(path.join(extension, file), 'utf8');
      for (const [, ref] of src.matchAll(/(?:src|href)="([^"#:]+)"/g)) check(dir, ref);
    }
  }
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  for (const ref of [manifest.background.service_worker, manifest.options_ui.page,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) check('', ref);
  assert.deepEqual(missing, []);
});
