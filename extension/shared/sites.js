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

/**
 * The site someone typed into a site list: a host ("github.com"), or an address whose host is
 * taken ("https://www.github.com/a" → "github.com"). "www." is dropped, as {@link siteKey} does.
 *
 * @param {string} text - What was typed.
 * @returns {string | null} The site, or null when it isn't a web host (no dot, a space, a scheme
 *   other than http or https…).
 * @example
 * siteFromInput(' https://www.GitHub.com/a '); // 'github.com'
 * siteFromInput('not a site'); // null
 */
export function siteFromInput(text) {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const key = siteKey(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  return key && (key.includes('.') || key === 'localhost') && !key.endsWith('.') ? key : null;
}

/**
 * Whether an address is on one of the listed sites, or a subdomain of one ("docs.github.com" is
 * on "github.com").
 *
 * @param {string} url - A tab's address.
 * @param {readonly string[]} sites - Sites, as {@link siteFromInput} gives them.
 * @returns {boolean} True when it's on one of them.
 * @example
 * onListedSite('https://docs.github.com/x', ['github.com']); // true
 */
export function onListedSite(url, sites) {
  const key = siteKey(url);
  return key !== null && sites.some((site) => key === site || key.endsWith(`.${site}`));
}
