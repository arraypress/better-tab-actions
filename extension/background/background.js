/**
 * The service worker's script: registers every listener (worker.js) and starts the light/dark
 * toolbar glyph, at top level, so both happen each time Chrome starts the worker for an event.
 *
 * @module background/background
 */
import { startToolbarTheme } from '../vendor/extension-kit/index.js';
import { startWorker } from './worker.js';

/** The menu's and the shortcuts' handlers, exported for the test builds' hook (test/e2e/hook.js). */
export const { handleMenuClick, handleCommand } = startWorker(chrome);

// The toolbar glyph follows light and dark mode, reported by the options page and an offscreen
// watcher. Every start: Chrome shows the manifest's light glyph after a restart or re-enable, and
// closes the offscreen watcher on quit.
startToolbarTheme(chrome);
