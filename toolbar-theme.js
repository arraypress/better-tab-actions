/**
 * The toolbar glyph follows the light or dark scheme, as Chrome's own toolbar icons do. The
 * service worker can't see the scheme (no matchMedia), so documents report it
 * (toolbar-scheme.js): the options page, and an offscreen document kept open for it, since
 * nothing else of ours runs on every page. This stores the last report per computer and shows
 * the matching glyph.
 */
import { TOOLBAR_DARK_KEY, TOOLBAR_SCHEME } from './toolbar-scheme.js';

/** The glyph for a scheme; the manifest's default_icon is the light one. From the root, as Chrome resolves setIcon paths against the worker's address. */
export const toolbarIcon = (dark) => {
  const scheme = dark ? 'dark' : 'light';
  return { 16: `/icons/toolbar/${scheme}-16.png`, 32: `/icons/toolbar/${scheme}-32.png`, 48: `/icons/toolbar/${scheme}-48.png` };
};

export const OFFSCREEN_PATH = 'offscreen.html';

export function createToolbarTheme({ storage, action, extensionId }) {
  // One report at a time, so two quick ones can't store one scheme and show the other.
  let queue = Promise.resolve();
  const show = (dark) => action.setIcon({ path: toolbarIcon(dark) });

  return {
    /** When the worker starts: after a restart or re-enable Chrome shows the manifest's light glyph. */
    restore() {
      queue = queue.then(async () => {
        const { [TOOLBAR_DARK_KEY]: dark } = await storage.get(TOOLBAR_DARK_KEY);
        if (dark === true) await show(true);
      }).catch((error) => console.error('Restoring the toolbar icon:', error));
      return queue;
    },

    /**
     * A report: only from this extension, only a boolean, and only written and shown when it
     * changes. Returns whether it was a scheme report (handled or ignored).
     */
    onMessage(message, sender) {
      if (message?.type !== TOOLBAR_SCHEME) return false;
      const { dark } = message;
      if (sender?.id !== extensionId || typeof dark !== 'boolean') return true;
      queue = queue.then(async () => {
        const { [TOOLBAR_DARK_KEY]: was = false } = await storage.get(TOOLBAR_DARK_KEY);
        if (was === dark) return;
        // Shown first: if Chrome refuses the icon, nothing is stored, and the next report tries again.
        await show(dark);
        await storage.set({ [TOOLBAR_DARK_KEY]: dark });
      }).catch((error) => console.error('Changing the toolbar icon:', error));
      return true;
    },

    /** Resolves once every report so far is handled (tests). */
    settled: () => queue,
  };
}

/**
 * Open the offscreen document that watches the scheme (reason MATCH_MEDIA), unless it's open.
 * It stays open: it's one small page in the extension's own process, and it's the only way to
 * hear a theme change while no page of ours is open. Chrome closes it when the browser quits,
 * so the background calls this each time it starts. Resolves to whether it opened one.
 */
let opening = null;
export function watchFromOffscreen({ offscreen, runtime }) {
  opening ??= (async () => {
    const open = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (open.length) return false;
    await offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [offscreen.Reason.MATCH_MEDIA],
      justification: 'Reads whether Chrome is in light or dark mode, to show the matching toolbar icon.',
    });
    return true;
  })().finally(() => { opening = null; });
  return opening;
}
