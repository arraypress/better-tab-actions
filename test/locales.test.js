/**
 * The words: every message the extension uses exists and every message is used, placeholders
 * line up, each counted pair is whole, en_GB only overrides en, and the wording follows Chrome's
 * (curly quotes and apostrophes, no exclamation marks, “…” only where a name is cut short).
 *
 * @module test/locales
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readMessages as readLocale } from '@arraypress/extension-kit/testing';
import { SITE_LIST_MESSAGES } from '../extension/vendor/extension-kit/index.js';
import { EXTENSION } from './helpers.js';

/** @param {string} locale - "en" or "en_GB". */
const readMessages = (locale) => readLocale(EXTENSION, locale);
const en = readMessages('en');

/**
 * Every script and page under a folder of the extension.
 *
 * @param {string} dir - Folder, from extension/.
 * @returns {string[]} Paths from extension/.
 */
const filesIn = (dir) => readdirSync(path.join(EXTENSION, dir), { recursive: true, encoding: 'utf8' })
  .map((file) => path.join(dir, file)).filter((file) => /\.(js|html)$/.test(file));

/**
 * Every message key the extension names: `t('…')`, an action's `message: '…'` and the `…_MESSAGE`
 * constants, both keys of a `counted(…)`, a page's title (`setUpPage`), a message shown with
 * names in bold, `data-i18n*` and `__MSG_…__`, and the site list's words, which the kit reads.
 *
 * @returns {Set<string>} The keys.
 */
function usedKeys() {
  const sources = ['background', 'offscreen', 'options', 'shared'].flatMap(filesIn).concat('manifest.json')
    .map((file) => readFileSync(path.join(EXTENSION, file), 'utf8')).join('\n');
  /** @param {RegExp} pattern - With a group for each key. */
  const found = (pattern) => [...sources.matchAll(pattern)].flatMap((match) => match.slice(1));
  return new Set([
    ...found(/\bt\('([A-Za-z]+)'/g),
    ...found(/\bmessage: '([A-Za-z]+)'/g),
    ...found(/_MESSAGE = '([A-Za-z]+)'/g),
    ...found(/\bcounted\([^,]+, '([A-Za-z]+)', '([A-Za-z]+)'/g),
    ...found(/setUpPage\(chrome, \{ title: '([A-Za-z]+)'/g),
    ...found(/showWithNames\([^,]+, '([A-Za-z]+)'/g),
    ...found(/data-i18n[a-z-]*="([A-Za-z]+)"/g),
    ...found(/__MSG_([A-Za-z]+)__/g),
    // The list has an Add button and ⋮ menus: no Remove button to label.
    ...Object.values(SITE_LIST_MESSAGES).filter((key) => key !== SITE_LIST_MESSAGES.removeLabel),
  ]);
}

test('messages: every key used exists in en, and every en key is used', () => {
  const used = usedKeys();
  assert.deepEqual([...used].filter((key) => !en[key]), [], 'used but missing');
  assert.deepEqual(Object.keys(en).filter((key) => !used.has(key)), [], 'defined but unused');
});

test('messages: each $NAME$ is a declared placeholder, and only those are declared', () => {
  for (const [key, { message, placeholders = {} }] of Object.entries(en)) {
    const named = [...new Set([...message.matchAll(/\$([A-Z]+)\$/g)].map((match) => match[1].toLowerCase()))];
    assert.deepEqual(Object.keys(placeholders).sort(), named.sort(), key);
  }
});

test('messages: a count has both its messages, “…One” without a number to fill and the other taking $COUNT$', () => {
  const ones = Object.keys(en).filter((key) => key.endsWith('One'));
  assert.ok(ones.length >= 8);
  for (const one of ones) {
    const many = en[one.slice(0, -'One'.length)];
    assert.ok(many, `${one} has no message for other counts`);
    assert.equal(en[one].placeholders, undefined, one);
    // The unit beside the days field has its number in the field.
    if (one !== 'optionsDayUnitOne') assert.deepEqual(many.placeholders, { count: { content: '$1' } }, one);
  }
});

test('messages: en_GB only overrides keys en has, with the same placeholders', () => {
  const gb = readMessages('en_GB');
  assert.ok(Object.keys(gb).length > 0);
  for (const [key, { placeholders }] of Object.entries(gb)) {
    assert.ok(en[key], key);
    assert.deepEqual(placeholders, en[key].placeholders, key);
  }
});

test('messages: Chrome’s wording: curly quotes, no straight apostrophes, no exclamation marks, “…” only for a label cut short', () => {
  for (const [key, { message }] of Object.entries(en)) {
    assert.doesNotMatch(message, /['"!]/, key);
    if (message.includes('…')) assert.equal(key, 'optionsInactiveAfterSub', message);
  }
});

test('messages: the name is written in the manifest’s three (the store name, the short name, the toolbar title); every other message takes it as $NAME$', () => {
  const name = en.extShortName.message;
  assert.deepEqual(Object.keys(en).filter((key) => en[key].message.includes(name)).sort(), ['extName', 'extShortName', 'toolbarTitle']);
  assert.ok(en.extName.message.startsWith(name));
});
