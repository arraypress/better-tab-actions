// The offscreen document (toolbar-theme.js watchFromOffscreen): it only watches the colour
// scheme. Offscreen documents get chrome.runtime and nothing else, so it can't read what's
// stored: it reports once on opening (the background drops a repeat), then on each change.
import { DARK_QUERY, reportColorScheme, sendScheme } from './toolbar-scheme.js';

/**
 * An offscreen document never renders, and Chrome fires a media query's `change` event as part
 * of rendering, so here it never comes (checked in Chromium 157: no animation frames either).
 * `matches` itself stays current, so look every few seconds: one cached boolean read, and a
 * message only when it differs.
 */
export const POLL_MS = 2000;

const check = reportColorScheme(matchMedia(DARK_QUERY), undefined, sendScheme);
setInterval(check, POLL_MS);
