/**
 * Sites and pages from tab addresses: what counts as the same site, and as the same page; a
 * window's main site. (Sites typed into a list are the kit's `siteHost`, tested there.)
 *
 * @module test/sites
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainSite, siteKey, pageKey } from '../extension/shared/sites.js';

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

test('mainSite: the site with more tabs than any other; null on a tie or with no web pages', () => {
  assert.equal(mainSite([{ url: 'https://a.com/1' }, { url: 'https://www.a.com/2' }, { url: 'https://b.com/' }]), 'a.com');
  assert.equal(mainSite([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]), null);
  assert.equal(mainSite([{ url: 'chrome://settings/' }]), null);
});
