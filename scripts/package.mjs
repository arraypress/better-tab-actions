/**
 * Zip the extension for the Chrome Web Store: release/better-tab-actions.zip,
 * exactly the contents of extension/ (manifest.json at its root) less the
 * source-only files (@arraypress/extension-kit `ZIP_EXCLUDE`: icon SVG
 * sources, type declarations, .DS_Store). Run through `npm run package`,
 * which runs the tests first; the About links' reminders print last.
 *
 * @module scripts/package
 */

import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { printReleaseChecks, zipExtension } from '@arraypress/extension-kit/build';
import { ABOUT_LINKS, REPOSITORY } from '../extension/options/about-links.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extension = path.join(root, 'extension');
const zip = path.join(root, 'release', 'better-tab-actions.zip');

await rm(path.dirname(zip), { recursive: true, force: true });
console.log(`Packaged ${path.relative(root, await zipExtension(extension, zip))}`);
printReleaseChecks(ABOUT_LINKS, REPOSITORY);
