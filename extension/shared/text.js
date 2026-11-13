/**
 * Wording more than one part of the extension uses: the words themselves (the `_locales`
 * messages, looked up with the kit's `translator`, and the UI language its `counted` writes
 * numbers in), short dates ("9 Nov") and durations ("3 days").
 *
 * @module shared/text
 */
import { counted, translator } from '../vendor/extension-kit/index.js';

/**
 * The extension's words: its message lookup and Chrome's UI language.
 *
 * @typedef {object} Words
 * @property {(key: string, substitutions?: string | string[]) => string} t A message by its key in
 *   `_locales` (the kit's `translator`: a missing key shows as itself).
 * @property {string} lang Chrome's UI language ("en-GB"), for numbers and dates.
 */

/**
 * The words, from `chrome.i18n`.
 *
 * @param {{getMessage(key: string, substitutions?: string | string[]): string, getUILanguage(): string}} i18n - `chrome.i18n`.
 * @returns {Words} The message lookup and the UI language.
 * @example
 * const words = wordsOf(chrome.i18n);
 * words.t('menuUnmuteTabs'); // 'Unmute tabs'
 */
export const wordsOf = (i18n) => ({ t: translator(i18n), lang: i18n.getUILanguage() });

/**
 * A short date, as Chrome writes one in lists: day and month, plus the year when it isn't the
 * year of `now`.
 *
 * @param {number} time - The date, in ms since the epoch.
 * @param {string} [locale] - The browser's own when left out.
 * @param {number} [now] - Today, to tell whether the year is needed. Default `time` (no year).
 * @returns {string} "9 Nov" (en-GB), "Nov 9" (en-US), "9 Nov 2025" in another year.
 * @example
 * shortDate(Date.UTC(2026, 10, 9), 'en-GB'); // '9 Nov'
 */
export function shortDate(time, locale, now = time) {
  const year = new Date(time).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year }).format(time);
}

/**
 * A number of hours in the largest whole unit, as Chrome's own settings lists say it.
 *
 * @param {number} hours - How many hours.
 * @param {Words} words - The extension's words.
 * @returns {string} "1 hour", "12 hours", "3 days", "1 week".
 * @example
 * duration(72, words); // '3 days'
 */
export function duration(hours, words) {
  if (hours % (24 * 7) === 0) return counted(hours / (24 * 7), 'durationWeeksOne', 'durationWeeks', words);
  if (hours % 24 === 0) return counted(hours / 24, 'durationDaysOne', 'durationDays', words);
  return counted(hours, 'durationHoursOne', 'durationHours', words);
}

/**
 * A number of minutes, in hours once it's whole hours.
 *
 * @param {number} minutes - How many minutes.
 * @param {Words} words - The extension's words.
 * @returns {string} "5 minutes", "1 hour".
 * @example
 * minutesText(60, words); // '1 hour'
 */
export function minutesText(minutes, words) {
  return minutes % 60 === 0 ? duration(minutes / 60, words) : counted(minutes, 'durationMinutesOne', 'durationMinutes', words);
}

/**
 * A date with its time of day, as the person's language writes them: what a snapshot is known by.
 *
 * @param {number} time - The moment, in ms since the epoch.
 * @param {string} [locale] - The browser's own when left out.
 * @returns {string} "13 Nov 2026, 21:54" (en-GB), "Nov 13, 2026, 9:54 PM" (en-US).
 */
export function dateTime(time, locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}
