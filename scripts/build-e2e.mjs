/**
 * Build the e2e test build from extension/: `.test-builds/e2e/`, the same files with a test hook
 * as the service worker's script (test/e2e/hook.js), which exposes what a menu click and a
 * keyboard shortcut call, because Chrome's native tab menu and shortcuts can't be driven
 * headlessly. test/e2e/auto-close.mjs makes a second build of its own, with an hour cut to a second.
 *
 *   npm run e2e    (builds first)
 *
 * @module scripts/build-e2e
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildTestCopy, testBuildDir } from '@arraypress/extension-kit/build';

/** The repository's root. */
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The test hook that becomes a test build's service worker. */
export const HOOK = path.join(ROOT, 'test/e2e/hook.js');

/**
 * Make a test build: extension/ with the hook as its service worker.
 *
 * @param {string} [name] - The build's folder under `.test-builds/` (or `$EXTENSION_TEST_BUILDS`). Default `e2e`.
 * @returns {Promise<string>} The build's folder.
 */
export const buildE2e = (name = 'e2e') => buildTestCopy({ from: path.join(ROOT, 'extension'), to: testBuildDir(ROOT, name), hook: HOOK });

// Run as a script: build the usual one. (Imported, as by auto-close.mjs, it builds nothing by itself.)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildE2e();
  console.log(`Built ${path.relative(ROOT, out) || out}/`);
}
