/**
 * Small pieces of wording more than one part of the extension uses: counted nouns ("3 tabs") and
 * short dates ("9 Nov"), in the user's locale.
 *
 * @module shared/text
 */

/**
 * A count and its noun, plural when it isn't 1.
 *
 * @param {number} n - How many.
 * @param {string} word - The singular noun; the plural adds "s".
 * @returns {string} "1 day", "2 days".
 * @example
 * plural(3, 'window'); // '3 windows'
 */
export const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

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
