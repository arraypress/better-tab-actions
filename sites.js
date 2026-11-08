/**
 * The site a URL belongs to, or null for non-web pages (chrome://, file://, etc.).
 * "www." is ignored, so www.example.com and example.com count as the same site.
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

/** URL of a tab, falling back to pendingUrl while it is still loading. */
export function tabUrl(tab) {
  return tab.url || tab.pendingUrl || '';
}

/** Key for spotting duplicate tabs: the full URL minus any #fragment. */
export function pageKey(url) {
  if (!url) return null;
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}
