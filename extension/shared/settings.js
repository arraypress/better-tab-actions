/**
 * Better Tab Actions' settings: what they are, their defaults, and how anything
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

import { createSettingsStore, MAX_SYNC_ITEM_BYTES, siteHost } from '../vendor/extension-kit/index.js';

/**
 * @typedef {object} Settings
 * @property {string[]} hiddenActions IDs of actions hidden from the menu (they still work as shortcuts).
 * @property {number} inactiveDays "Close tabs not used in N days", {@link MIN_DAYS}–{@link MAX_DAYS}.
 * @property {'window' | 'all'} windowScope Site, duplicate and inactive closing: the clicked tab's window only, or all windows.
 * @property {boolean} includeGroupedTabs Whether close actions may close tabs that are in a tab group.
 * @property {boolean} autoClose Whether unused tabs are closed automatically (off by default).
 * @property {number} autoCloseHours How long a tab goes unused before it's closed automatically: one of {@link AUTO_CLOSE_HOURS}.
 * @property {string[]} keepSites Sites whose tabs are never closed automatically ("Never close tabs from these sites").
 * @property {boolean} reopenGroups Whether opening a workspace makes its tab groups again (Chrome
 *   adds each group it makes to its saved tab groups, so reopening adds another copy each time).
 */

/** The fewest days "Close tabs not used in N days" accepts. */
const MIN_DAYS = 1;
/** The most days it accepts. */
const MAX_DAYS = 365;

/** The ages "Close unused tabs automatically" offers, in hours: 1, 4 and 12 hours, 1 and 3 days, 1 week. */
export const AUTO_CLOSE_HOURS = /** @type {readonly number[]} */ (Object.freeze([1, 4, 12, 24, 72, 168]));

/**
 * The never-close sites, valid and without repeats, cut where the list would no longer fit one
 * Chrome Sync item (8,192 bytes, key included).
 *
 * @param {unknown} raw - A stored or typed list.
 * @returns {string[]} The sites.
 */
function keepSitesFrom(raw) {
  const sites = [...new Set((Array.isArray(raw) ? raw : []).flatMap((site) => (siteHost(site) ?? [])))];
  /** @type {string[]} */
  const kept = [];
  for (const site of sites) {
    if (new TextEncoder().encode(`keepSites${JSON.stringify([...kept, site])}`).length > MAX_SYNC_ITEM_BYTES) break;
    kept.push(site);
  }
  return kept;
}

/**
 * Every setting's default: every action shown, this window, 7 days, grouped tabs included, no
 * automatic closing (1 week once it's on, no sites kept), workspaces' groups reopened.
 */
export const DEFAULTS = /** @type {Readonly<Settings>} */ (Object.freeze({
  hiddenActions: [],
  inactiveDays: 7,
  windowScope: 'window',
  includeGroupedTabs: true,
  autoClose: false,
  autoCloseHours: 168,
  keepSites: [],
  reopenGroups: true,
}));

/**
 * Coerce anything read from storage (or a form) into valid settings: junk
 * falls back to the default, days are rounded and clamped, hidden actions
 * de-duplicated, the automatic age is one offered, kept sites are valid hosts.
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
    autoClose: typeof raw.autoClose === 'boolean' ? raw.autoClose : DEFAULTS.autoClose,
    autoCloseHours: AUTO_CLOSE_HOURS.includes(Number(raw.autoCloseHours)) ? Number(raw.autoCloseHours) : DEFAULTS.autoCloseHours,
    keepSites: keepSitesFrom(raw.keepSites),
    reopenGroups: typeof raw.reopenGroups === 'boolean' ? raw.reopenGroups : DEFAULTS.reopenGroups,
  };
}

/** Loading, saving and change detection, over `chrome.storage` (or a fake in tests). */
export const settingsStore = createSettingsStore({ defaults: DEFAULTS, normalize: normalizeSettings });
