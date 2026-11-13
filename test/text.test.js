/**
 * Wording helpers: the words from `chrome.i18n`, short dates and durations.
 *
 * @module test/text
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration, shortDate, wordsOf } from '../extension/shared/text.js';
import { I18N, WORDS } from './helpers.js';

test('shortDate: day and month, with the year only when it differs from now’s', () => {
  assert.equal(shortDate(Date.UTC(2026, 10, 9, 12), 'en-GB'), '9 Nov');
  assert.equal(shortDate(Date.UTC(2026, 10, 9, 12), 'en-US'), 'Nov 9');
  assert.equal(shortDate(Date.UTC(2025, 10, 9, 12), 'en-GB', Date.UTC(2026, 0, 1, 12)), '9 Nov 2025');
});

test('duration: hours in the largest whole unit', () => {
  assert.deepEqual([1, 4, 12, 24, 72, 168, 336, 36].map((hours) => duration(hours, WORDS)), ['1 hour', '4 hours', '12 hours', '1 day', '3 days', '1 week', '2 weeks', '36 hours']);
});

test('wordsOf: the messages by key (a missing key shows as itself), the extension’s name filled in, and Chrome’s language', () => {
  const words = wordsOf(I18N);
  assert.equal(words.t('menuUnmuteTabs'), 'Unmute tabs');
  assert.equal(words.t('optionsAbout'), 'About Better Tab Actions');
  assert.equal(words.t('optionsVersion', ['1.0.0']), 'Version 1.0.0');
  assert.equal(words.t('noSuchMessage'), 'noSuchMessage');
  assert.equal(words.lang, 'en-GB');
});

test('counts are written as the language writes numbers', () => {
  const words = wordsOf({ ...I18N, getUILanguage: () => 'de' });
  assert.equal(duration(1500, words), '1.500 hours');
});
