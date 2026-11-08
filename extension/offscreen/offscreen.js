/**
 * The offscreen document the worker keeps open to hear light/dark changes
 * for the toolbar glyph (@arraypress/extension-kit `startToolbarTheme`).
 *
 * @module offscreen/offscreen
 */

import { watchSchemeOffscreen } from '../vendor/extension-kit/index.js';

watchSchemeOffscreen(chrome.runtime);
