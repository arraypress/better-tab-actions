/**
 * What a tab's address says: the site it belongs to, the page it shows, and
 * the address itself while it's still loading. Shared by the actions and the
 * closed-tab batch.
 *
 * @module shared/sites
 */

/**
 * A tab as `chrome.tabs.query` reports it. Chrome's docs make `lastAccessed`
 * optional (tabs from before Chrome 121 have none); `@types/chrome` says it's
 * always there, so it's loosened here and the actions check for it.
 *
 * @typedef {Omit<chrome.tabs.Tab, 'lastAccessed'> & {lastAccessed?: number}} Tab
 */

/**
 * The site a URL belongs to, or null for non-web pages (chrome://, file://, etc.).
 * "www." is ignored, so www.example.com and example.com count as the same site.
 *
 * @param {string} url - Any address, valid or not.
 * @returns {string | null} The host without "www.", or null.
 * @example
 * siteKey('https://www.example.com/a'); // 'example.com'
 * siteKey('chrome://extensions/'); // null
 */
export function siteKey(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname.replace(/^www\./, '');
}

/**
 * URL of a tab, falling back to pendingUrl while it is still loading.
 *
 * @param {Pick<Tab, 'url' | 'pendingUrl'>} tab - The tab.
 * @returns {string} Its address, or '' when it has none yet.
 */
export function tabUrl(tab) {
  return tab.url || tab.pendingUrl || '';
}

/**
 * Key for spotting duplicate tabs: the full URL minus any #fragment.
 *
 * @param {string} url - A tab's address.
 * @returns {string | null} The address without its fragment, or null for no address.
 * @example
 * pageKey('https://a.com/p?x=1#top'); // 'https://a.com/p?x=1'
 */
export function pageKey(url) {
  if (!url) return null;
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}
