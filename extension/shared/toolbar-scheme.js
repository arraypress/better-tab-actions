/**
 * Tells the background whether this document sees a light or dark colour scheme, so it can swap
 * the toolbar glyph (toolbar-theme.js). The service worker has no matchMedia, so documents report:
 * the options page, and the offscreen document the background keeps open for this.
 */

/** chrome.storage.local: the scheme last reported. This computer's, never synced. */
export const TOOLBAR_DARK_KEY = 'toolbarDark';

/** The report: { type, dark: boolean }. */
export const TOOLBAR_SCHEME = 'toolbar-scheme';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Send `dark` now if it differs from `known` (what's stored), then on each change: a page load
 * where nothing changed sends nothing. `known` undefined (unknown) sends once. Returns the check,
 * for a document that has to poll it (offscreen.js).
 */
export function reportColorScheme(media, known, send) {
  let last = known;
  const report = () => {
    if (media.matches === last) return;
    last = media.matches;
    send(last);
  };
  report();
  media.addEventListener('change', report);
  return report;
}

/** The worker may be asleep or restarting: a lost report is retried by the next change or page. */
export const sendScheme = (dark) => chrome.runtime.sendMessage({ type: TOOLBAR_SCHEME, dark }).catch(() => {});

/** For extension pages: read what's stored, then report. */
export async function watchColorScheme() {
  const { [TOOLBAR_DARK_KEY]: stored } = await chrome.storage.local.get(TOOLBAR_DARK_KEY);
  reportColorScheme(matchMedia(DARK_QUERY), stored === true, sendScheme);
}
