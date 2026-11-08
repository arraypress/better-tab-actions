/**
 * More Tab Actions' settings: what they are, their defaults, and how anything
 * read from storage or the options page becomes valid settings.
 *
 * They live in chrome.storage.sync, one item per setting (the store is
 * @arraypress/extension-kit's), so they follow the user to their other
 * computers through their own Chrome Sync, like Chrome's own settings. They
 * are plain preferences (which menu items show, days, windows), not personal
 * data, and Chrome Sync keeps them in the user's own Google account: the
 * developer receives nothing, so "no data collected" stays true. None is tied
 * to one computer.
 *
 * @module shared/settings
 */

import { createSettingsStore } from '../vendor/extension-kit/index.js';

/**
 * @typedef {object} Settings
 * @property {string[]} hiddenActions IDs of actions hidden from the menu (they still work as shortcuts).
 * @property {number} inactiveDays "Close tabs not used in N days", {@link MIN_DAYS}–{@link MAX_DAYS}.
 * @property {'window' | 'all'} windowScope Site, duplicate and inactive closing: the clicked tab's window only, or all windows.
 * @property {boolean} includeGroupedTabs Whether close actions may close tabs that are in a tab group.
 */

/** The fewest days "Close tabs not used in N days" accepts. */
export const MIN_DAYS = 1;
/** The most days it accepts. */
export const MAX_DAYS = 365;

/** Every setting's default: every action shown, this window, 7 days, grouped tabs included. */
export const DEFAULTS = /** @type {Readonly<Settings>} */ (Object.freeze({
  hiddenActions: [],
  inactiveDays: 7,
  windowScope: 'window',
  includeGroupedTabs: true,
}));

/**
 * Coerce anything read from storage (or a form) into valid settings: junk
 * falls back to the default, days are rounded and clamped, hidden actions
 * de-duplicated.
 *
 * @param {Record<string, unknown>} [raw] - Stored or typed values; missing ones take the default.
 * @returns {Settings} Valid settings.
 * @example
 * normalizeSettings({ inactiveDays: '14.4', windowScope: 'everywhere' });
 * // { ...DEFAULTS, inactiveDays: 14 }
 */
export function normalizeSettings(raw = {}) {
  const days = Math.round(Number(raw.inactiveDays));
  return {
    hiddenActions: Array.isArray(raw.hiddenActions)
      ? [...new Set(raw.hiddenActions.filter((id) => typeof id === 'string'))]
      : [...DEFAULTS.hiddenActions],
    inactiveDays: Number.isFinite(days) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, days)) : DEFAULTS.inactiveDays,
    windowScope: raw.windowScope === 'all' || raw.windowScope === 'window' ? raw.windowScope : DEFAULTS.windowScope,
    includeGroupedTabs: typeof raw.includeGroupedTabs === 'boolean' ? raw.includeGroupedTabs : DEFAULTS.includeGroupedTabs,
  };
}

/** Loading, saving and change detection, over `chrome.storage` (or a fake in tests). */
export const settingsStore = createSettingsStore({ defaults: DEFAULTS, normalize: normalizeSettings });
