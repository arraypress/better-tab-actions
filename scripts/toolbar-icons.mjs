/**
 * Render the toolbar glyph (extension/icons/toolbar/glyph.svg, and
 * glyph-16.svg fitted to whole pixels) into light-/dark-16/32/48.png in
 * Chrome's toolbar icon colours. Run by hand after editing a source:
 * `npm run toolbar-icons`. The PNGs are committed.
 *
 * @module scripts/toolbar-icons
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { renderToolbarIcons } from '@arraypress/extension-kit/build';

const dir = fileURLToPath(new URL('../extension/icons/toolbar/', import.meta.url));
for (const file of await renderToolbarIcons({ chromium, dir })) console.log(`wrote ${file}`);
