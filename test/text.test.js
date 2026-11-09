/**
 * Wording helpers: counted nouns, short dates and durations.
 *
 * @module test/text
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration, plural, shortDate } from '../extension/shared/text.js';

test('plural: singular only for one', () => {
  assert.deepEqual([plural(0, 'tab'), plural(1, 'tab'), plural(2, 'tab')], ['0 tabs', '1 tab', '2 tabs']);
});

test('shortDate: day and month, with the year only when it differs from now’s', () => {
  assert.equal(shortDate(Date.UTC(2026, 10, 9, 12), 'en-GB'), '9 Nov');
  assert.equal(shortDate(Date.UTC(2026, 10, 9, 12), 'en-US'), 'Nov 9');
  assert.equal(shortDate(Date.UTC(2025, 10, 9, 12), 'en-GB', Date.UTC(2026, 0, 1, 12)), '9 Nov 2025');
});

test('duration: hours in the largest whole unit', () => {
  assert.deepEqual([1, 4, 12, 24, 72, 168, 336, 36].map(duration), ['1 hour', '4 hours', '12 hours', '1 day', '3 days', '1 week', '2 weeks', '36 hours']);
});
