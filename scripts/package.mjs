/**
 * Zip the extension for the Chrome Web Store: release/more-tab-actions.zip. The zip is exactly
 * the contents of extension/ (manifest.json at its root), less the source-only files in EXCLUDE.
 * Run through `npm run package`, which runs the tests and the kit check first and the
 * placeholder-link warning last.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const EXTENSION = path.join(root, 'extension');
export const ZIP = path.join(root, 'release', 'more-tab-actions.zip');

/**
 * zip -x patterns (a `*` crosses folders): the toolbar glyph's SVG sources
 * (scripts/toolbar-icons.mjs renders the PNGs that ship) and Finder's .DS_Store files.
 */
export const EXCLUDE = ['icons/*.svg', '*.DS_Store'];

/** Zip everything under `from` into `to`, paths relative to `from`. */
export async function zipExtension(from = EXTENSION, to = ZIP) {
  await mkdir(path.dirname(to), { recursive: true });
  await rm(to, { force: true });
  // -X leaves out macOS extended attributes (the store rejects __MACOSX entries); -D leaves out
  // folder entries, so the zip lists files only.
  execFileSync('zip', ['-r', '-X', '-D', '-q', to, '.', '-x', ...EXCLUDE], { cwd: from, stdio: 'inherit' });
  return to;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await rm(path.dirname(ZIP), { recursive: true, force: true });
  console.log(`Packaged ${path.relative(root, await zipExtension())}`);
}
