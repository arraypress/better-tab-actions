/**
 * Render the toolbar glyph (icons/toolbar/glyph.svg, and glyph-16.svg fitted to whole pixels)
 * into light-/dark-16/32/48.png in Chrome's toolbar icon colours. Run by hand after editing a
 * source: `npm run toolbar-icons`. The renderer lives in the shared design kit
 * (../Extensions/_chrome-ui), outside this repo; the PNGs it makes are committed.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const kit = new URL('../../Extensions/_chrome-ui/toolbar-icons.mjs', import.meta.url);
if (!existsSync(fileURLToPath(kit))) {
  console.error('The toolbar icons are drawn by the shared design kit (../Extensions/_chrome-ui), which isn’t next to this repo. The committed PNGs in icons/toolbar/ are current.');
  process.exit(1);
}
const { renderToolbarIcons } = await import(kit.href);

const dir = fileURLToPath(new URL('../icons/toolbar/', import.meta.url));
for (const file of await renderToolbarIcons({ chromium, dir })) console.log(`wrote ${file}`);
