/**
 * Drawing kit for store screenshots: a 1280×800 canvas with a caption band, a Chrome window
 * (macOS, light or dark, default theme) and macOS-style context menus. Everything here is
 * presentation around real captures; nothing is a feature of the extension.
 *
 * Window metrics follow Chrome's 2023 refresh on macOS (tabs 34px high in a 42px strip, a 46px
 * toolbar with a pill omnibox). Menus follow macOS's native menu (13px system font, 22px rows):
 * on macOS, Chrome's tab and page context menus are native NSMenus.
 *
 * @module store/tools/frame
 */

/**
 * A shot's window size and zoom: see {@link geometry}.
 *
 * @typedef {{zoom: number, w: number, content: {width: number, height: number}}} Geometry
 */

/**
 * A tab in the drawn strip.
 *
 * @typedef {object} DrawnTab
 * @property {string} title Its title.
 * @property {string} icon Its favicon's address.
 * @property {boolean} [active] The selected tab.
 * @property {boolean} [audible] Shows the speaker.
 * @property {boolean} [muted] Shows the muted speaker.
 */

/**
 * A row in a drawn menu: an item, or `'sep'` for a separator.
 *
 * @typedef {{title: string, icon?: string, iconSvg?: string, sub?: boolean, disabled?: boolean, selected?: boolean} | 'sep'} MenuItem
 */

/** @typedef {keyof typeof THEMES} ThemeName */

/** The store screenshot's width, px. */
export const W = 1280;
/** Its height, px. */
export const H = 800;
const CAPTION_H = 112;
/** Where the Chrome window sits, and its tab strip's and toolbar's heights, px. */
export const WIN = { x: 64, y: CAPTION_H, w: 1152, strip: 42, toolbar: 46 };

/**
 * A shot's window is drawn at `zoom` (scaled about its top-left corner) so text stays legible
 * when the store shows screenshots small.
 *
 * @param {number} [zoom] - The scale. Default 1.
 * @returns {Geometry} The zoom, the window's unscaled width and the size to capture page content
 *   at (captured at 2× so the scaling stays sharp).
 */
export function geometry(zoom = 1) {
  const w = Math.round((W - 2 * WIN.x) / zoom);
  return { zoom, w, content: { width: w, height: Math.round((H - WIN.y) / zoom) - WIN.strip - WIN.toolbar } };
}

/**
 * @param {unknown} s - Text.
 * @returns {string} It, escaped for HTML text and attributes.
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const P = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  forward: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
  reload: 'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  puzzle: 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z',
  star: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  sound: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  muted: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  book: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
};
/**
 * A Material icon.
 *
 * @param {keyof typeof P} name - Which one.
 * @param {number} [size] - Its size, px. Default 20.
 * @param {string} [extra] - More attributes for the `<svg>`.
 * @returns {string} The SVG markup.
 */
const icon = (name, size = 20, extra = '') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${extra}><path fill="currentColor" d="${P[name]}"/></svg>`;
/**
 * Chrome's split view icon.
 *
 * @param {number} [size] - Its size, px. Default 16.
 * @returns {string} The SVG markup.
 */
const splitIcon = (size = 16) =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" stroke-width="1.3"/></svg>`;

/**
 * A letter favicon for made-up sites (no real brands).
 *
 * @param {string} letter - The letter.
 * @param {string} bg - The tile's colour.
 * @param {string} [fg] - The letter's colour. Default white.
 * @returns {string} A data: URL.
 */
export const letterIcon = (letter, bg, fg = '#fff') =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${bg}"/><text x="8" y="12" font-family="-apple-system,Helvetica,Arial" font-size="11" font-weight="700" text-anchor="middle" fill="${fg}">${letter}</text></svg>`)}`;

/** The colours of the canvas, window and menus, light and dark. */
export const THEMES = {
  light: {
    bg: '#eef2f8', caption: '#1f1f1f', sub: '#444746',
    frame: '#dde3ea', tabText: '#1f1f1f', tabTextInactive: '#474747', tabSep: '#a8afb8', activeTab: '#ffffff',
    toolbar: '#ffffff', toolbarIcon: '#474747', omnibox: '#e9eef6', url: '#1f1f1f', urlDim: '#5e5e5e',
    contentLine: '#d3d7dc', shadow: '0 24px 60px rgba(31,45,70,.20), 0 0 0 .5px rgba(0,0,0,.18)',
    menuBg: 'rgba(244,244,246,.96)', menuText: '#1d1d1f', menuDisabled: 'rgba(0,0,0,.26)', menuSep: 'rgba(0,0,0,.11)',
    menuBorder: 'rgba(0,0,0,.14)', menuIcon: '#3c3c43',
  },
  dark: {
    bg: '#1b1c1f', caption: '#e3e3e3', sub: '#c4c7c5',
    frame: '#1f1f1f', tabText: '#e3e3e3', tabTextInactive: '#c7c7c7', tabSep: '#5f6368', activeTab: '#3c3c3c',
    toolbar: '#3c3c3c', toolbarIcon: '#c7c7c7', omnibox: '#282828', url: '#e3e3e3', urlDim: '#a8a8a8',
    contentLine: '#2a2a2a', shadow: '0 24px 60px rgba(0,0,0,.55), 0 0 0 .5px rgba(255,255,255,.14)',
    menuBg: 'rgba(40,40,42,.96)', menuText: '#f2f2f7', menuDisabled: 'rgba(255,255,255,.28)', menuSep: 'rgba(255,255,255,.14)',
    menuBorder: 'rgba(255,255,255,.16)', menuIcon: '#d1d1d6',
  },
};
const ACCENT = 'rgb(10 100 230)';

const TAB_H = 34;

/**
 * Lay out tabs like Chrome: equal widths up to 240px, shrinking to fit.
 *
 * @param {readonly unknown[]} tabs - The tabs (only their number counts).
 * @param {object} [options] - The strip.
 * @param {number} [options.left] - Where the first tab starts. Default 84.
 * @param {number} [options.right] - Room kept free at the end. Default 60.
 * @param {number} [options.max] - The widest a tab gets. Default 240.
 * @param {number} [options.w] - The window's width. Default {@link WIN}'s.
 * @returns {{x: number, width: number}[]} Each tab's window-relative x offset and width.
 */
export function tabLayout(tabs, { left = 84, right = 60, max = 240, w = WIN.w } = {}) {
  const avail = w - left - right - 36;
  const width = Math.min(max, Math.floor(avail / tabs.length));
  return tabs.map((_, i) => ({ x: left + i * width, width }));
}

/**
 * The window's tab strip and toolbar. Positions are window-relative; add {@link WIN}'s x and y
 * for page coordinates.
 *
 * @param {object} options - What the window shows.
 * @param {readonly DrawnTab[]} options.tabs - The tabs, in order.
 * @param {string} options.url - The omnibox text.
 * @param {string} [options.urlHost] - Its start, drawn darker (the rest is dimmed).
 * @param {ThemeName} [options.theme] - Default light.
 * @param {number} [options.w] - The window's width. Default {@link WIN}'s.
 * @param {{x: number, width: number}[]} [options.layout] - From {@link tabLayout}. Default: laid out to `w`.
 * @param {readonly string[]} [options.ext] - Extension icons to show in the toolbar.
 * @param {readonly number[]} [options.marks] - Indexes of tabs to outline.
 * @returns {string} The HTML, with its styles.
 */
export function windowChrome({ tabs, url, urlHost, theme = 'light', w = WIN.w, layout = tabLayout(tabs, { w }), ext = [], marks = [] }) {
  const t = THEMES[theme];
  const tabHtml = tabs.map((tab, i) => {
    const { x, width } = layout[i];
    const sepAfter = i < tabs.length - 1 && !tab.active && !tabs[i + 1].active;
    const alert = tab.muted ? icon('muted', 16) : tab.audible ? icon('sound', 16) : '';
    const showClose = tab.active || width >= 120;
    const mark = marks.includes(i) ? `<span class="mark" style="left:${x + 4}px;width:${width - 8}px"></span>` : '';
    return `${mark}<div class="tab${tab.active ? ' active' : ''}" style="left:${x}px;width:${width}px">
      <img class="fav" src="${tab.icon}" width="16" height="16" alt="">
      <span class="title">${esc(tab.title)}</span>
      ${alert ? `<span class="alert">${alert}</span>` : ''}
      ${showClose ? `<span class="x">${icon('close', 14)}</span>` : ''}
    </div>${sepAfter ? `<span class="sep" style="left:${x + width - 1}px"></span>` : ''}`;
  }).join('');
  const last = layout[layout.length - 1];
  const plusX = last.x + last.width + 4;
  const extIcons = ext.map((src) => `<img src="${src}" width="16" height="16" alt="" style="margin:0 9px">`).join('');
  return `
  <div class="strip">
    <span class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>
    ${tabHtml}
    <span class="plus" style="left:${plusX}px">${icon('add', 18)}</span>
  </div>
  <div class="toolbar">
    <span class="tb">${icon('back')}</span><span class="tb dim">${icon('forward')}</span><span class="tb">${icon('reload')}</span>
    <div class="omni"><span class="site">${icon('tune', 16)}</span><span class="url">${urlHost ? `${esc(urlHost)}<span class="dim">${esc(url.slice(urlHost.length))}</span>` : esc(url)}</span><span class="star">${icon('star', 18)}</span></div>
    ${extIcons}<span class="tb">${icon('puzzle')}</span>
    <span class="avatar">${icon('person', 18)}</span><span class="tb">${icon('more')}</span>
  </div>
  <style>
    .strip { position: relative; height: ${WIN.strip}px; background: ${t.frame}; }
    .lights { position: absolute; left: 16px; top: 15px; display: flex; gap: 8px; }
    .lights i { width: 12px; height: 12px; border-radius: 50%; display: block; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.12); }
    .tab { position: absolute; bottom: 0; height: ${TAB_H}px; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 14px; box-sizing: border-box; color: ${t.tabTextInactive}; font: 12px/16px system-ui; }
    .tab.active { background: ${t.activeTab}; color: ${t.tabText}; border-radius: 10px 10px 0 0; z-index: 1; }
    .tab.active::before, .tab.active::after { content: ''; position: absolute; bottom: 0; width: 10px; height: 10px; }
    .tab.active::before { left: -10px; background: radial-gradient(circle at 0 0, transparent 10px, ${t.activeTab} 10.5px); }
    .tab.active::after { right: -10px; background: radial-gradient(circle at 100% 0, transparent 10px, ${t.activeTab} 10.5px); }
    .tab .fav { flex: none; }
    .tab .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 18px), transparent); }
    .tab .alert, .tab .x { flex: none; display: flex; color: ${t.toolbarIcon}; }
    .mark { position: absolute; bottom: 3px; height: 28px; border-radius: 8px; background: rgba(217,48,37,.14); box-shadow: inset 0 0 0 1.5px rgba(217,48,37,.75); }
    .sep { position: absolute; bottom: 9px; width: 1px; height: 18px; background: ${t.tabSep}; }
    .plus { position: absolute; top: 11px; display: flex; color: ${t.toolbarIcon}; padding: 2px; }
    .toolbar { height: ${WIN.toolbar}px; background: ${t.toolbar}; display: flex; align-items: center; gap: 4px; padding: 0 8px; box-sizing: border-box; border-bottom: 1px solid ${t.contentLine}; }
    .tb { width: 34px; height: 34px; display: grid; place-items: center; color: ${t.toolbarIcon}; flex: none; }
    .tb.dim { opacity: .45; }
    .omni { flex: 1; min-width: 0; height: 34px; margin: 0 8px; border-radius: 17px; background: ${t.omnibox}; display: flex; align-items: center; gap: 10px; padding: 0 12px; color: ${t.url}; font: 14px system-ui; }
    .omni .site { display: flex; color: ${t.toolbarIcon}; }
    .omni .url { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .omni .dim { color: ${t.urlDim}; }
    .omni .star { display: flex; color: ${t.toolbarIcon}; }
    .avatar { flex: none; width: 26px; height: 26px; margin: 0 4px; border-radius: 50%; background: #7cacf8; color: #fff; display: grid; place-items: end center; overflow: hidden; }
  </style>`;
}

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
  const t = THEMES[theme];
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
export const MENU_ICONS = { split: splitIcon(16), book: icon('book', 16) };

const MENU_CSS = `
  .mac-menu { position: absolute; border-radius: ${MENU.radius}px; -webkit-backdrop-filter: blur(30px) saturate(1.6); backdrop-filter: blur(30px) saturate(1.6); font: 13px/16px system-ui; z-index: 10; }
  .m-row { position: absolute; left: ${MENU.pad}px; right: ${MENU.pad}px; height: ${MENU.row}px; display: flex; align-items: center; padding: 0 10px 0 9px; border-radius: 5px; white-space: nowrap; }
  .m-row.sel { background: ${ACCENT}; }
  .m-title { flex: 1; }
  .m-chev { display: flex; margin-left: 16px; }
  .m-sep { position: absolute; left: 14px; right: 14px; height: 1px; }`;

/**
 * The macOS arrow pointer.
 *
 * @param {number} x - Its tip's page x.
 * @param {number} y - Its tip's page y.
 * @returns {string} The SVG markup.
 */
export const cursor = (x, y) => `<svg style="position:absolute;left:${x - 4}px;top:${y - 3}px;z-index:20;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))" width="22" height="30" viewBox="0 0 22 30">
  <path d="M4 3 L4 24 L9 19.5 L12.4 27 L15.6 25.6 L12.3 18.3 L19 18.3 Z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

/**
 * The full page: caption band, window, content and overlays.
 *
 * @param {object} shot - What it shows.
 * @param {string} shot.caption - The caption.
 * @param {ThemeName} [shot.theme] - Default light.
 * @param {string} shot.chrome - The window's strip and toolbar, from {@link windowChrome}.
 * @param {string} shot.content - An <img> src (a capture at `geo`'s content size) or raw HTML.
 * @param {string} [shot.overlays] - Markup over everything (menus, the pointer).
 * @param {Geometry} [shot.geo] - The window's zoom. Default {@link geometry}(1).
 * @returns {string} The HTML page.
 */
export function canvas({ caption, theme = 'light', chrome, content, overlays = '', geo = geometry(1) }) {
  const t = THEMES[theme];
  const { width: cw, height: ch } = geo.content;
  const inner = content.startsWith('<') ? content : `<img src="${content}" width="${cw}" height="${ch}" alt="" style="display:block">`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; }
    body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: ${t.bg}; -webkit-font-smoothing: antialiased; }
    .caption { position: absolute; left: 0; right: 0; top: 0; height: ${CAPTION_H}px; display: grid; place-items: center; font: 500 32px/1.2 system-ui; letter-spacing: -.2px; color: ${t.caption}; }
    .stage { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform: scale(${geo.zoom}); transform-origin: ${WIN.x}px ${WIN.y}px; }
    .window { position: absolute; left: ${WIN.x}px; top: ${WIN.y}px; width: ${geo.w}px; height: ${ch + WIN.strip + WIN.toolbar + 20}px; border-radius: 12px 12px 0 0; overflow: hidden; box-shadow: ${t.shadow}; }
    .content { position: absolute; left: 0; top: ${WIN.strip + WIN.toolbar}px; width: ${cw}px; height: ${ch}px; overflow: hidden; background: ${theme === 'dark' ? '#202124' : '#fff'}; }
    ${MENU_CSS}
  </style></head><body>
    <div class="caption">${caption}</div>
    <div class="stage"><div class="window">${chrome}<div class="content">${inner}</div></div>
    ${overlays}</div>
  </body></html>`;
}
