/**
 * What the store screenshots draw that @arraypress/extension-kit's `storeFrame` (the canvas, the
 * caption and Chrome's window) doesn't: Chrome's tab right-click menu as macOS draws it, with its
 * submenu's rows where a caller can find them, and outlines over tabs in the strip. Everything
 * here is presentation around real captures; nothing is a feature of the extension.
 *
 * Menus follow macOS's native menu (13px system font, 22px rows): on macOS, Chrome's tab and page
 * context menus are native NSMenus. (The kit's `contextMenuHtml` draws the page menu at a fixed
 * width, light only, its submenu level with its row; the tab menu here needs icons of Chrome's
 * own, a submenu moved up to stay on screen, and each row's position for the pointer.)
 *
 * @module store/tools/frame
 */
import { storeFrame } from '@arraypress/extension-kit/build';

/**
 * A row in a drawn menu: an item, or `'sep'` for a separator.
 *
 * @typedef {{title: string, icon?: string, iconSvg?: string, sub?: boolean, disabled?: boolean, selected?: boolean} | 'sep'} MenuItem
 */

/** @typedef {storeFrame.Theme} ThemeName */

/**
 * @param {unknown} s - Text.
 * @returns {string} It, escaped for HTML text and attributes.
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A menu's colours, light and dark, as macOS draws a native menu. */
const MENU_THEMES = {
  light: {
    menuBg: 'rgba(244,244,246,.96)', menuText: '#1d1d1f', menuDisabled: 'rgba(0,0,0,.26)', menuSep: 'rgba(0,0,0,.11)',
    menuBorder: 'rgba(0,0,0,.14)', menuIcon: '#3c3c43',
  },
  dark: {
    menuBg: 'rgba(40,40,42,.96)', menuText: '#f2f2f7', menuDisabled: 'rgba(255,255,255,.28)', menuSep: 'rgba(255,255,255,.14)',
    menuBorder: 'rgba(255,255,255,.16)', menuIcon: '#d1d1d6',
  },
};
const ACCENT = 'rgb(10 100 230)';

/**
 * Where the kit's `windowChrome` draws each tab: equal widths up to 240px, shrinking to fit (its
 * own layout isn't exported; the outlines and the menus are placed from this).
 *
 * @param {readonly unknown[]} tabs - The tabs (only their number counts).
 * @param {number} [w] - The window's width. Default the store frame's.
 * @returns {{x: number, width: number}[]} Each tab's window-relative x offset and width.
 */
export function tabLayout(tabs, w = storeFrame.WIN.w) {
  const width = Math.min(240, Math.floor((w - 84 - 60 - 36) / Math.max(1, tabs.length)));
  return tabs.map((_, i) => ({ x: 84 + i * width, width }));
}

/**
 * Red outlines over tabs in a strip drawn by the kit's `windowChrome`, to go in the same
 * positioned box as the strip.
 *
 * @param {readonly unknown[]} tabs - The strip's tabs.
 * @param {readonly number[]} marks - Indexes of the tabs to outline.
 * @param {number} [w] - The window's width. Default the store frame's.
 * @returns {string} The HTML.
 */
export function tabMarks(tabs, marks, w) {
  const layout = tabLayout(tabs, w);
  return marks.map((i) => `<span style="position:absolute;z-index:2;left:${layout[i].x + 4}px;top:${storeFrame.WIN.strip - 31}px;width:${layout[i].width - 8}px;height:28px;border-radius:8px;background:rgba(217,48,37,.14);box-shadow:inset 0 0 0 1.5px rgba(217,48,37,.75)"></span>`).join('');
}

/**
 * A Material icon.
 *
 * @param {string} d - Its path.
 * @param {number} [size] - Its size, px. Default 16.
 * @returns {string} The SVG markup.
 */
const icon = (d, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="${d}"/></svg>`;
const BOOK = 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z';
/**
 * Chrome's split view icon.
 *
 * @param {number} [size] - Its size, px. Default 16.
 * @returns {string} The SVG markup.
 */
const splitIcon = (size = 16) =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" stroke-width="1.3"/></svg>`;

/** A macOS menu's metrics, px: padding, row and separator heights, corner radius. */
export const MENU = { pad: 5, row: 22, sep: 11, radius: 10 };

/**
 * A macOS context menu.
 *
 * @param {readonly MenuItem[]} items - Its rows.
 * @param {object} place - Where and how.
 * @param {number} place.x - Its page x.
 * @param {number} place.y - Its page y.
 * @param {number} place.width - Its width.
 * @param {ThemeName} [place.theme] - Default light.
 * @param {string} [place.id] - An id for the element.
 * @returns {{html: string, height: number, width: number, x: number, y: number, rowTop: (i: number) => number}}
 *   The markup, its box, and the page y of row `i`.
 */
export function menu(items, { x, y, width, theme = 'light', id = '' }) {
  const t = MENU_THEMES[theme];
  let top = MENU.pad;
  /** @type {string[]} */
  const rows = [];
  /** @type {number[]} */
  const tops = [];
  for (const item of items) {
    tops.push(top);
    if (item === 'sep') {
      rows.push(`<div class="m-sep" style="top:${top + 5}px;background:${t.menuSep}"></div>`);
      top += MENU.sep;
      continue;
    }
    const color = item.selected ? '#fff' : item.disabled ? t.menuDisabled : t.menuText;
    const iconHtml = item.icon
      ? `<img src="${item.icon}" width="16" height="16" alt="" style="margin-right:6px">`
      : item.iconSvg
        ? `<span style="display:flex;margin-right:6px;color:${item.selected ? '#fff' : item.disabled ? t.menuDisabled : t.menuIcon}">${item.iconSvg}</span>`
        : '';
    rows.push(`<div class="m-row${item.selected ? ' sel' : ''}" style="top:${top}px;color:${color}">
      ${iconHtml}<span class="m-title">${esc(item.title)}</span>${item.sub ? `<span class="m-chev">${chevron(color)}</span>` : ''}</div>`);
    top += MENU.row;
  }
  const height = top + MENU.pad;
  const html = `<div class="mac-menu" ${id ? `id="${id}"` : ''} style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;background:${t.menuBg};box-shadow:0 0 0 .5px ${t.menuBorder}, 0 12px 32px rgba(0,0,0,${theme === 'dark' ? '.5' : '.22'}), 0 2px 6px rgba(0,0,0,.08)">${rows.join('')}</div>`;
  return { html, height, width, x, y, rowTop: (i) => y + tops[i] };
}
/**
 * A submenu's chevron.
 *
 * @param {string} color - Its colour.
 * @returns {string} The SVG markup.
 */
const chevron = (color) =>
  `<svg width="8" height="12" viewBox="0 0 8 12"><path d="M1.5 1 L6.5 6 L1.5 11" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** Icons Chrome's tab menu shows: split view and reading list. */
export const MENU_ICONS = { split: splitIcon(16), book: icon(BOOK) };

/** The menus' styles, for a `<style>` beside them. */
export const MENU_CSS = `
  .mac-menu { position: absolute; border-radius: ${MENU.radius}px; -webkit-backdrop-filter: blur(30px) saturate(1.6); backdrop-filter: blur(30px) saturate(1.6); font: 13px/16px system-ui; z-index: 10; }
  .m-row { position: absolute; left: ${MENU.pad}px; right: ${MENU.pad}px; height: ${MENU.row}px; display: flex; align-items: center; padding: 0 10px 0 9px; border-radius: 5px; white-space: nowrap; }
  .m-row.sel { background: ${ACCENT}; }
  .m-title { flex: 1; }
  .m-chev { display: flex; margin-left: 16px; }
  .m-sep { position: absolute; left: 14px; right: 14px; height: 1px; }`;
