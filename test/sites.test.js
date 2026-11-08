import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteKey, pageKey } from '../extension/shared/sites.js';

test('siteKey treats www and bare domain as the same site', () => {
  assert.equal(siteKey('https://www.example.com/a'), 'example.com');
  assert.equal(siteKey('http://example.com/b?q=1'), 'example.com');
});

test('siteKey keeps other subdomains distinct', () => {
  assert.equal(siteKey('https://docs.example.com/'), 'docs.example.com');
});

test('siteKey returns null for non-web and invalid URLs', () => {
  assert.equal(siteKey('chrome://extensions/'), null);
  assert.equal(siteKey('file:///Users/me/a.html'), null);
  assert.equal(siteKey(''), null);
});

test('pageKey ignores #fragments but keeps query strings', () => {
  assert.equal(pageKey('https://a.com/p?x=1#top'), 'https://a.com/p?x=1');
  assert.notEqual(pageKey('https://a.com/p?x=1'), pageKey('https://a.com/p?x=2'));
  assert.equal(pageKey(''), null);
});
