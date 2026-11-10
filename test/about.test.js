/**
 * The About card's links. The placeholder warning and repository reminder are tested in
 * @arraypress/extension-kit; here, that these links are real and the package step prints them.
 *
 * @module test/about
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPlaceholder } from '../extension/vendor/extension-kit/index.js';
import { ABOUT_LINKS, REPOSITORY } from '../extension/options/about-links.js';

test('about links: help, “Report an issue” and privacy all live in the GitHub repository', () => {
  assert.equal(REPOSITORY, 'https://github.com/arraypress/better-tab-actions');
  assert.deepEqual(ABOUT_LINKS, {
    help: 'https://github.com/arraypress/better-tab-actions#readme',
    reportIssue: 'https://github.com/arraypress/better-tab-actions/issues',
    privacyPolicy: 'https://github.com/arraypress/better-tab-actions/blob/main/PRIVACY.md',
  });
  assert.deepEqual(Object.values(ABOUT_LINKS).filter(isPlaceholder), []);
});

test('the package step ends with the About links’ checks', () => {
  assert.match(readFileSync(new URL('../scripts/package.mjs', import.meta.url), 'utf8'), /printReleaseChecks\(ABOUT_LINKS, REPOSITORY\);\s*$/);
});
