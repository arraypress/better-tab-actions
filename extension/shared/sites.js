/**
 * What a tab's address says: the site it belongs to, the page it shows, and
 * the address itself while it's still loading, and how long an address may
 * be to be kept. Shared by the actions, the closed-tab batch and workspaces. Sites typed into a list, and whether a tab is on one, are
 * the kit's (`siteHost`, `onSite`).
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
 * The longest address kept for reopening, in a workspace or the closed batch. Longer ones are big
 * `data:` pages: a few would fill the storage the rest is kept in.
 */
export const MAX_URL = 8192;

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

/** What the address of a page's source starts with; the page's own address follows. */
const VIEW_SOURCE = 'view-source:';

/**
 * An address without its `user:password@` part, so a password typed into an address isn't kept
 * where addresses are stored. Addresses with none, and ones that aren't URLs, come back unchanged.
 *
 * @param {string} url - A tab's address.
 * @returns {string} The address without credentials.
 * @example
 * withoutCredentials('https://me:secret@example.com/inbox'); // 'https://example.com/inbox'
 * withoutCredentials('https://example.com/@me'); // unchanged
 * withoutCredentials('view-source:https://me:secret@example.com/'); // 'view-source:https://example.com/'
 */
export function withoutCredentials(url) {
  if (!url.includes('@')) return url;
  if (url.startsWith(VIEW_SOURCE)) return `${VIEW_SOURCE}${withoutCredentials(url.slice(VIEW_SOURCE.length))}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.username && !parsed.password) return url;
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
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

/**
 * The main site among some tabs: the one with more of them than any other site. Non-web pages
 * don't count.
 *
 * @param {readonly Pick<Tab, 'url' | 'pendingUrl'>[]} tabs - The tabs.
 * @returns {string | null} The site ("github.com"), or null when there's none or two tie.
 * @example
 * mainSite([{ url: 'https://a.com/1' }, { url: 'https://a.com/2' }, { url: 'https://b.com/' }]); // 'a.com'
 * mainSite([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]); // null
 */
export function mainSite(tabs) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const tab of tabs) {
    const key = siteKey(tabUrl(tab));
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1]);
  return first && (!second || first[1] > second[1]) ? first[0] : null;
}
