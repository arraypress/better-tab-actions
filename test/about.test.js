import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ABOUT_LINKS, isPlaceholder } from '../extension/options/about-links.js';
import { placeholderWarning } from '../scripts/warn-placeholder-links.mjs';

const script = fileURLToPath(new URL('../scripts/warn-placeholder-links.mjs', import.meta.url));

test('about links: help and privacy on the web, “Report an issue” emails the developer', () => {
  assert.deepEqual(Object.keys(ABOUT_LINKS), ['help', 'reportIssue', 'privacyPolicy']);
  assert.match(ABOUT_LINKS.help, /^https:\/\//);
  assert.match(ABOUT_LINKS.privacyPolicy, /^https:\/\//);
  // All three live in the GitHub repo: README, Issues, PRIVACY.md.
  assert.deepEqual(ABOUT_LINKS, {
    help: 'https://github.com/arraypress/more-tab-actions#readme',
    reportIssue: 'https://github.com/arraypress/more-tab-actions/issues',
    privacyPolicy: 'https://github.com/arraypress/more-tab-actions/blob/main/PRIVACY.md',
  });
});

test('placeholder check: example.com (and its subdomains) is a placeholder, a real domain or mailto isn’t', () => {
  assert.equal(isPlaceholder('https://example.com/x'), true);
  assert.equal(isPlaceholder('https://www.example.org/x'), true);
  assert.equal(isPlaceholder('https://arraypress.com/more-tab-actions/help'), false);
  assert.equal(isPlaceholder('https://notexample.com/'), false);
  assert.equal(isPlaceholder(ABOUT_LINKS.reportIssue), false);
});

test('package warning: printed loudly while a link is a placeholder, naming each one', () => {
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(run.status, 0); // A warning, not a failure: the zip is still fine for testing.
  const placeholders = Object.entries(ABOUT_LINKS).filter(([, url]) => isPlaceholder(url));
  if (!placeholders.length) return assert.equal(run.stderr, '');
  assert.match(run.stderr, /WARNING: the About card still has placeholder links/);
  for (const [name, url] of placeholders) assert.ok(run.stderr.includes(`${name}: ${url}`), name);
  assert.ok(!run.stderr.includes('reportIssue'));
});

test('package warning: none once every link is real', () => {
  assert.equal(placeholderWarning({
    help: 'https://arraypress.com/more-tab-actions/help',
    reportIssue: ABOUT_LINKS.reportIssue,
    privacyPolicy: 'https://arraypress.com/more-tab-actions/privacy',
  }), null);
  assert.match(placeholderWarning({ help: 'https://example.com/help' }), /help: https:\/\/example\.com\/help/);
});

test('package script ends with the placeholder warning and ships the links', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  // Everything under extension/ ships (test/package.test.js).
  assert.ok(existsSync(new URL('../extension/options/about-links.js', import.meta.url)));
  assert.match(pkg.scripts.package, /&& node scripts\/warn-placeholder-links\.mjs$/);
});

test('package reminder: links on GitHub mean the repo must be public before submitting', async () => {
  const { repositoryReminder } = await import('../scripts/warn-placeholder-links.mjs');
  assert.match(repositoryReminder(), /Make the repository public before submitting/);
  assert.equal(repositoryReminder({ help: 'https://plainly.tools/help' }), null);
});
