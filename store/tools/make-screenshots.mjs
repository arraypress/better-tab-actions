/**
 * Store screenshots and promo tile for More Tab Actions → ../screenshot-*.png, ../promo-440x280.png.
 *
 *   node store/tools/make-screenshots.mjs
 *
 * Loads extension/ as an unpacked extension in Playwright's Chromium (Playwright 1.64.0 from the
 * Tabby repo, launched the way Tabby's e2e tests do) and:
 * - captures the real options page (light and dark);
 * - opens real tabs and runs the real "Close duplicate tabs" action (actions.js runAction, as
 *   background.js does) to get the before/after tab lists;
 * - takes the submenu's labels from actions.js menuEntries, so they match the build.
 *
 * Chrome's own tab right-click menu is native and can't be captured headlessly, so it is drawn
 * (frame.mjs): Chrome 157 on macOS, items and order from Chromium's tab_menu_model.cc at tag
 * 157.0.8103.39 (Title Case strings on macOS), for a signed-out profile with one window and no
 * tab groups. The extension's submenu has no separator: Chrome drops separators in tab-menu
 * submenus (docs/bug-report/report.md), so that's what users see today.
 *
 * Web pages in the shots are made up (no real sites); photos are CC0 from Wikimedia Commons.
 *
 * @module store/tools/make-screenshots
 */
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  H, MENU, MENU_ICONS, THEMES, W, WIN, canvas, cursor, geometry, letterIcon, menu, tabLayout, windowChrome,
} from './frame.mjs';

/** @import { Page } from 'playwright' */
/** @import { DrawnTab, Geometry, MenuItem, ThemeName } from './frame.mjs' */
/** @import { MenuEntry } from '../../extension/shared/actions.js' */
/** @import * as Actions from '../../extension/shared/actions.js' */
/** @import * as SettingsModule from '../../extension/shared/settings.js' */

/**
 * The extension's own modules, as the options page imports them (relative to options/), for
 * code run inside it.
 */
const MODULES = { actions: '../shared/actions.js', settings: '../shared/settings.js' };

const ZOOMED = geometry(1.2);
const tools = path.dirname(fileURLToPath(import.meta.url));
const store = path.dirname(tools);
const extension = path.join(path.dirname(store), 'extension');
const tmp = await mkdtemp(path.join(tmpdir(), 'mta-store-'));
/**
 * @param {string} file - A local file.
 * @param {string} [type] - Its media type. Default PNG.
 * @returns {Promise<string>} It, as a data: URL.
 */
const dataUrl = async (file, type = 'image/png') => `data:${type};base64,${(await readFile(file)).toString('base64')}`;
/** @param {string} name - A photo in photos/, without .jpg. */
const photo = (name) => dataUrl(path.join(tools, 'photos', `${name}.jpg`), 'image/jpeg');
const EXT_ICON = await dataUrl(path.join(extension, 'icons', 'icon-32.png'));

// ---------------------------------------------------------------- made-up sites

const SITES = {
  trail: { brand: 'Trailhead Journal', color: '#2e7d4f', icon: letterIcon('T', '#2e7d4f') },
  mail: { brand: 'Postbox', color: '#1a73e8', icon: letterIcon('P', '#1a73e8') },
  plan: { brand: 'Taskboard', color: '#7b48c8', icon: letterIcon('W', '#7b48c8') },
  food: { brand: 'Larder', color: '#e8710a', icon: letterIcon('L', '#e8710a') },
  tune: { brand: 'Tunebox', color: '#d93025', icon: letterIcon('♪', '#d93025') },
  meet: { brand: 'Huddle', color: '#00897b', icon: letterIcon('H', '#00897b') },
};

/**
 * A plain article page for a made-up site.
 *
 * @param {object} article - Its parts.
 * @param {keyof typeof SITES} article.site - Whose.
 * @param {string} article.kicker - The section above the headline.
 * @param {string} article.title - The page title ("Headline – Site").
 * @param {string} article.photoUrl - The lead photo.
 * @param {string} article.dek - The standfirst.
 * @returns {string} The HTML.
 */
function article({ site, kicker, title, photoUrl, dek }) {
  const s = SITES[site];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <link rel="icon" href="${s.icon}">
  <style>
    body { margin: 0; font: 16px/1.6 Georgia, serif; color: #202124; background: #fff; }
    header { display: flex; align-items: center; gap: 28px; padding: 18px 64px; border-bottom: 1px solid #e8eaed; font: 500 14px system-ui; color: #5f6368; }
    header b { font: 700 20px Georgia, serif; color: ${s.color}; margin-right: auto; }
    main { display: grid; grid-template-columns: 1fr 300px; gap: 48px; padding: 32px 64px; }
    .kicker { font: 600 12px system-ui; letter-spacing: .08em; text-transform: uppercase; color: ${s.color}; }
    h1 { font-size: 40px; line-height: 1.15; margin: 8px 0 12px; }
    .dek { color: #5f6368; margin: 0 0 20px; font-size: 18px; }
    img { width: 100%; height: 330px; object-fit: cover; border-radius: 6px; display: block; }
    aside h3 { font: 600 13px system-ui; text-transform: uppercase; letter-spacing: .06em; color: #5f6368; margin: 30px 0 12px; }
    aside p { margin: 0 0 14px; padding-bottom: 14px; border-bottom: 1px solid #eee; font-size: 15px; line-height: 1.4; }
  </style></head><body>
  <header><b>${s.brand}</b><span>Trails</span><span>Coast</span><span>Mountains</span><span>Gear</span></header>
  <main><div><div class="kicker">${kicker}</div><h1>${title.split(' – ')[0]}</h1><p class="dek">${dek}</p><img src="${photoUrl}" alt=""></div>
  <aside><h3>Most read</h3><p>Coastal lighthouse walks for a windy weekend</p><p>Ten mountain lakes worth the early start</p><p>What to pack for a day on the fells</p><p>The quiet trails nobody tells you about</p></aside></main>
  </body></html>`;
}

// ---------------------------------------------------------------- browser

const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium',
  viewport: geometry(1).content,
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
const optionsUrl = `chrome-extension://${extensionId}/options/options.html`;

// Made-up sites, answered locally (the network edge).
/** @type {Record<string, string>} */
const pages = {};
await context.route('https://*.example/**', (route) => {
  const html = pages[route.request().url()];
  return html ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.fulfill({ status: 404, body: '' });
});

const trailPhoto = await photo('bierstadt');
const lakePhoto = await photo('lake');
const lighthousePhoto = await photo('chania');
const PAGES = {
  bierstadt: { url: 'https://trailhead.example/bierstadt-lake-loop', html: article({ site: 'trail', kicker: 'Mountains', title: 'Bierstadt Lake loop – Trailhead Journal', photoUrl: trailPhoto, dek: 'An easy morning hike with big views of the Continental Divide.' }) },
  lighthouses: { url: 'https://trailhead.example/coastal-lighthouse-walks', html: article({ site: 'trail', kicker: 'Coast', title: 'Coastal lighthouse walks – Trailhead Journal', photoUrl: lighthousePhoto, dek: 'Five short walks that end at a lighthouse.' }) },
  lakes: { url: 'https://trailhead.example/mountain-lakes', html: article({ site: 'trail', kicker: 'Mountains', title: 'Ten mountain lakes – Trailhead Journal', photoUrl: lakePhoto, dek: 'Worth the early start.' }) },
  mail: { url: 'https://postbox.example/inbox', html: `<title>Inbox (3) – Postbox</title><link rel="icon" href="${SITES.mail.icon}">` },
  plan: { url: 'https://taskboard.example/week', html: `<title>Weekly planner – Taskboard</title><link rel="icon" href="${SITES.plan.icon}">` },
  food: { url: 'https://larder.example/lemon-tart', html: `<title>Lemon tart – Larder</title><link rel="icon" href="${SITES.food.icon}">` },
};
for (const { url, html } of Object.values(PAGES)) pages[url] = html;

/**
 * Screenshot `url` at the window's content size for `geo` (at 2×).
 *
 * @param {Page} page - The tab to use.
 * @param {string} url - What to load.
 * @param {string} file - The capture's name in the temporary folder.
 * @param {object} [options] - How.
 * @param {Geometry} [options.geo] - The window's zoom. Default 1.2.
 * @param {() => void} [options.scrollTo] - Run in the page before the capture.
 * @param {boolean} [options.dark] - Emulate dark mode.
 * @returns {Promise<string>} The capture, as a data: URL.
 */
async function capture(page, url, file, { geo = ZOOMED, scrollTo, dark = false } = {}) {
  await page.setViewportSize(geo.content);
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  if (scrollTo) await page.evaluate(scrollTo);
  await page.waitForTimeout(400);
  const out = path.join(tmp, file);
  await page.screenshot({ path: out });
  return dataUrl(out);
}

// The submenu, as the build makes it (default settings; state as given, on top of NO_STATE).
const helper = await context.newPage();
await helper.goto(optionsUrl);
/**
 * @param {Partial<Actions.MenuState>} state - What differs from NO_STATE.
 * @returns {Promise<MenuEntry[]>} The submenu's entries.
 */
const entries = (state) => helper.evaluate(async ({ state, modules }) => {
  const { menuEntries, NO_STATE } = /** @type {typeof Actions} */ (await import(modules.actions));
  const { DEFAULTS } = /** @type {typeof SettingsModule} */ (await import(modules.settings));
  return menuEntries(DEFAULTS, { ...NO_STATE, ...state });
}, { state, modules: MODULES });
// The menu shots' window: five ungrouped tabs, none pinned, so the group items are enabled.
const defaultEntries = await entries({ ungroupedTabs: 5 });
/**
 * Chrome drops the separator in tab-menu submenus (see the header).
 *
 * @param {readonly MenuEntry[]} list - The entries.
 * @returns {Extract<MenuEntry, {id: string}>[]} The ones a user sees.
 */
const shown = (list) => list.flatMap((entry) => (entry.separator ? [] : [entry]));

/**
 * @param {readonly MenuEntry[]} list - The entries.
 * @param {string} id - An action.
 * @returns {string} Its label.
 */
const titleOf = (list, id) => {
  const title = list.find((entry) => entry.id === id)?.title;
  if (!title) throw new Error(`No menu entry ${id}`);
  return title;
};

// ---------------------------------------------------------------- real duplicate run

/** Open real tabs, run "Close duplicate tabs" on the active one, and read the strip before and after. */
async function duplicateRun() {
  /** @type {(keyof typeof PAGES)[]} */
  const order = ['bierstadt', 'mail', 'bierstadt', 'plan', 'lighthouses', 'mail', 'bierstadt', 'food'];
  const opened = [];
  for (const key of order) {
    const page = await context.newPage();
    await page.goto(PAGES[key].url);
    opened.push(page);
  }
  await opened[0].bringToFront();
  await opened[0].waitForTimeout(300);
  const strip = () => helper.evaluate(async (urls) => {
    const all = await chrome.tabs.query({});
    return all.filter((tab) => tab.url !== undefined && urls.includes(tab.url)).sort((a, b) => a.windowId - b.windowId || a.index - b.index)
      .map(({ id, title, url, active, windowId }) => ({ id, title, url, active, windowId }));
  }, Object.values(PAGES).map((p) => p.url));
  const before = await strip();
  const targetId = before[0]?.id;
  if (targetId === undefined) throw new Error('No tabs opened');
  const closed = await helper.evaluate(async ({ targetId, modules }) => {
    const { runAction } = /** @type {typeof Actions} */ (await import(modules.actions));
    const { settingsStore } = /** @type {typeof SettingsModule} */ (await import(modules.settings));
    const tab = await chrome.tabs.get(targetId);
    const browser = { tabs: chrome.tabs, windows: chrome.windows, session: chrome.storage.session, tabGroups: chrome.tabGroups };
    return runAction('close-duplicate-tabs', tab, browser, { settings: await settingsStore.load(chrome.storage), extensionId: chrome.runtime.id });
  }, { targetId, modules: MODULES });
  const after = await strip();
  for (const page of opened) if (!page.isClosed()) await page.close();
  return { before, after, closed, targetId };
}
const dup = await duplicateRun();
console.log(`Duplicates: ${dup.before.length} tabs → ${dup.after.length} (closed ${dup.closed.length})`);
if (dup.before.length !== 8 || dup.after.length !== 5) throw new Error('Unexpected duplicate result');

// ---------------------------------------------------------------- content captures

const shotPage = await context.newPage();
const content = {
  bierstadt: await capture(shotPage, PAGES.bierstadt.url, 'bierstadt.png'),
  lakes: await capture(shotPage, PAGES.lakes.url, 'lakes.png'),
};
/** @param {string | undefined} url - A made-up site's address. */
const siteIcon = (url = '') => (url.includes('trailhead') ? SITES.trail.icon : url.includes('postbox') ? SITES.mail.icon : url.includes('taskboard') ? SITES.plan.icon : SITES.food.icon);

// ---------------------------------------------------------------- Chrome's tab menu (drawn)

/**
 * Chrome 157's tab context menu on macOS for an active tab, one window, no groups, signed out.
 *
 * @param {object} options - What depends on the tab.
 * @param {boolean} [options.closeRightEnabled] - Whether there are tabs to its right. Default true.
 * @returns {MenuItem[]} The rows.
 */
function chromeTabMenu({ closeRightEnabled = true }) {
  return [
    { title: 'New Tab to the Right' },
    { title: 'Add Tab to New Split View', iconSvg: MENU_ICONS.split },
    { title: 'Add Tab to New Group' },
    { title: 'Move Tab to New Window' },
    'sep',
    { title: 'Reload' },
    { title: 'Duplicate' },
    { title: 'Pin' },
    { title: 'Mute Site' },
    'sep',
    { title: 'Add Tab to Reading List', iconSvg: MENU_ICONS.book },
    'sep',
    { title: 'Show Tabs Vertically' },
    'sep',
    { title: 'More tab actions', icon: EXT_ICON, sub: true, selected: true },
    'sep',
    { title: 'Close' },
    { title: 'Close Other Tabs' },
    { title: 'Close Tabs to the Right', disabled: !closeRightEnabled },
  ];
}
const OURS_INDEX = 14;

/**
 * Tab strip + the open menu and submenu, with the pointer on `hover` (a submenu title).
 *
 * @param {object} shot - What it shows.
 * @param {string} shot.caption - The caption.
 * @param {DrawnTab[]} shot.tabs - The tabs.
 * @param {string} shot.url - The omnibox text.
 * @param {string} shot.urlHost - Its host.
 * @param {string} shot.page - The content capture.
 * @param {string} shot.hover - The submenu title under the pointer.
 * @param {MenuEntry[]} shot.entryList - The submenu.
 * @param {ThemeName} [shot.theme] - Default light.
 * @param {number} shot.clickTab - The right-clicked tab's index.
 * @param {Geometry} [shot.geo] - The window's zoom. Default 1.2.
 * @returns {string} The HTML page.
 */
function menuShot({ caption, tabs, url, urlHost, page, hover, entryList, theme = 'light', clickTab, geo = ZOOMED }) {
  const layout = tabLayout(tabs, { w: geo.w });
  const chrome = windowChrome({ tabs, url, urlHost, theme, w: geo.w, layout, ext: [] });
  const tab = layout[clickTab];
  const mx = WIN.x + tab.x + Math.round(tab.width * 0.45);
  const my = WIN.y + 26;
  const main = menu(chromeTabMenu({ closeRightEnabled: clickTab < tabs.length - 1 }), { x: mx, y: my, width: 236, theme });
  const subItems = shown(entryList).map((entry) => ({ title: entry.title, disabled: !entry.enabled, selected: entry.title === hover }));
  const subY = main.rowTop(OURS_INDEX) - MENU.pad;
  const sub = menu(subItems, { x: main.x + main.width - 3, y: subY, width: 246, theme });
  const hoverIndex = subItems.findIndex((item) => item.selected);
  const pointer = cursor(sub.x + 150, sub.rowTop(hoverIndex) + 13);
  return canvas({ caption, theme, chrome, content: page, overlays: main.html + sub.html + pointer, geo });
}

/**
 * @param {number} active - The index of the selected tab.
 * @returns {DrawnTab[]} Five tabs, three from the trail site.
 */
const trailTabs = (active) => [
  { title: 'Inbox (3) – Postbox', icon: SITES.mail.icon },
  { title: 'Bierstadt Lake loop – Trailhead Journal', icon: SITES.trail.icon, active: active === 1 },
  { title: 'Coastal lighthouse walks – Trailhead Journal', icon: SITES.trail.icon },
  { title: 'Weekly planner – Taskboard', icon: SITES.plan.icon },
  { title: 'Ten mountain lakes – Trailhead Journal', icon: SITES.trail.icon },
];

/** @type {string[]} */
const shots = [];

// 1. Close every tab from this site.
shots.push(menuShot({
  caption: 'Close every tab from this site',
  tabs: trailTabs(1),
  url: 'trailhead.example/bierstadt-lake-loop', urlHost: 'trailhead.example',
  page: content.bierstadt,
  hover: shown(defaultEntries)[0]?.title ?? '',
  entryList: defaultEntries,
  clickTab: 1,
}));

// 2. Close duplicates: the real before/after. Closed tabs are outlined in the "before" strip.
{
  const geo = geometry(1);
  const page = await capture(shotPage, PAGES.bierstadt.url, 'bierstadt-wide.png', { geo });
  /**
   * @param {typeof dup.before} list - Tabs read from Chrome.
   * @returns {DrawnTab[]} Them, to draw.
   */
  const toTabs = (list) => list.map((tab) => ({ title: tab.title ?? '', icon: siteIcon(tab.url), active: tab.id === dup.targetId }));
  /**
   * @param {typeof dup.before} list - Tabs read from Chrome.
   * @param {number[]} [marks] - Indexes to outline.
   * @returns {string} The window's strip and toolbar.
   */
  const strip = (list, marks = []) => {
    const tabs = toTabs(list);
    return windowChrome({ tabs, url: 'trailhead.example/bierstadt-lake-loop', urlHost: 'trailhead.example', layout: tabLayout(tabs, { max: 200 }), marks });
  };
  const closedIds = new Set(dup.closed);
  const marks = dup.before.flatMap((tab, i) => (tab.id !== undefined && closedIds.has(tab.id) ? [i] : []));
  const closeTitle = titleOf(defaultEntries, 'close-duplicate-tabs');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: ${THEMES.light.bg}; -webkit-font-smoothing: antialiased; }
    .caption { position: absolute; left: 0; right: 0; top: 0; height: 112px; display: grid; place-items: center; font: 500 32px/1.2 system-ui; letter-spacing: -.2px; color: #1f1f1f; }
    .label { position: absolute; left: ${WIN.x + 2}px; font: 400 16px system-ui; color: #444746; }
    .label b { font-weight: 600; color: #1f1f1f; }
    .win { position: absolute; left: ${WIN.x}px; width: ${WIN.w}px; overflow: hidden; box-shadow: ${THEMES.light.shadow}; background: #fff; }
    .pill { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 8px 16px 8px 12px; border-radius: 20px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.18); font: 500 15px system-ui; color: #1f1f1f; white-space: nowrap; }
    .arrow { position: absolute; left: 50%; width: 2px; background: #9aa0a6; transform: translateX(-1px); }
  </style></head><body>
    <div class="caption">Close duplicate tabs, keep one of each</div>
    <div class="label" style="top:124px">Before: <b>${dup.before.length} tabs</b>, some open more than once</div>
    <div class="win" style="top:152px;height:${WIN.strip + WIN.toolbar}px;border-radius:12px">${strip(dup.before, marks)}</div>
    <div class="arrow" style="top:252px;height:84px"></div>
    <div class="pill" style="top:272px"><img src="${EXT_ICON}" width="16" height="16" alt="">More tab actions › ${closeTitle}</div>
    <div class="label" style="top:346px">After: <b>${dup.after.length} tabs</b>, one of each page</div>
    <div class="win" style="top:374px;height:460px;border-radius:12px 12px 0 0">${strip(dup.after)}<img src="${page}" width="${geo.content.width}" height="${geo.content.height}" alt="" style="display:block"></div>
  </body></html>`;
  shots.push(html);
}

// 3. Mute every other tab.
shots.push(menuShot({
  caption: 'Mute every other tab',
  tabs: [
    { title: 'Morning playlist – Tunebox', icon: SITES.tune.icon, audible: true },
    { title: 'Ten mountain lakes – Trailhead Journal', icon: SITES.trail.icon, active: true },
    { title: 'Inbox (3) – Postbox', icon: SITES.mail.icon },
    { title: 'Team stand-up recording – Huddle', icon: SITES.meet.icon, audible: true },
    { title: 'Weekly planner – Taskboard', icon: SITES.plan.icon },
  ],
  url: 'trailhead.example/mountain-lakes', urlHost: 'trailhead.example',
  page: content.lakes,
  hover: titleOf(defaultEntries, 'mute-other-tabs'),
  entryList: defaultEntries,
  clickTab: 1,
}));

/**
 * A shot of the options page, as the active tab of two.
 *
 * @param {object} shot - What it shows.
 * @param {string} shot.caption - The caption.
 * @param {string} shot.page - The options page's capture.
 * @param {ThemeName} [shot.theme] - Default light.
 * @returns {string} The HTML page.
 */
function optionsShot({ caption, page, theme = 'light' }) {
  const tabs = [
    { title: 'Bierstadt Lake loop – Trailhead Journal', icon: SITES.trail.icon },
    { title: 'More Tab Actions settings', icon: EXT_ICON, active: true },
  ];
  return canvas({
    caption,
    theme,
    chrome: windowChrome({ tabs, url: optionsUrl, theme, w: ZOOMED.w, ext: [EXT_ICON] }),
    content: page,
    geo: ZOOMED,
  });
}

// 4. Options page (light): the Menu card, with one action switched off by a real click.
{
  await shotPage.goto(optionsUrl);
  await shotPage.waitForLoadState('networkidle');
  await shotPage.getByRole('switch').nth(4).click(); // "Close tabs to the left"
  await shotPage.waitForTimeout(2000); // let "Saved" fade
  const page = await capture(shotPage, optionsUrl, 'options-light.png');
  shots.push(optionsShot({ caption: 'Choose what’s in the menu', page }));
}

// 5. Options page (dark): closing settings and shortcuts, from the Closing tabs title down.
{
  const page = await capture(shotPage, optionsUrl, 'options-dark.png', {
    dark: true,
    scrollTo: () => {
      const title = document.getElementById('h-closing');
      if (!title) throw new Error('No Closing tabs title');
      scrollTo(0, title.getBoundingClientRect().top + scrollY - 16);
    },
  });
  const fits = await shotPage.evaluate(() =>
    (document.getElementById('h-shortcuts')?.nextElementSibling?.getBoundingClientRect().bottom ?? Infinity) <= innerHeight);
  if (!fits) throw new Error('Shot 5: the Keyboard shortcuts card no longer fits');
  shots.push(optionsShot({ caption: 'Pick the windows, the days and your shortcuts', page, theme: 'dark' }));
}

await context.close();

// ---------------------------------------------------------------- render

const browser = await chromium.launch();
const render = await browser.newPage({ viewport: { width: W, height: H } });
for (const [i, html] of shots.entries()) {
  const file = path.join(tmp, `shot-${i + 1}.html`);
  await writeFile(file, html);
  await render.goto(`file://${file}`);
  await render.waitForTimeout(300);
  await render.screenshot({ path: path.join(store, `screenshot-${i + 1}.png`) });
  console.log(`store/screenshot-${i + 1}.png`);
}

// Promo tile, 440×280.
{
  const icon128 = await dataUrl(path.join(extension, 'icons', 'icon-128.png'));
  await render.setViewportSize({ width: 440, height: 280 });
  const file = path.join(tmp, 'promo.html');
  await writeFile(file, `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; width: 440px; height: 280px; overflow: hidden; display: grid; place-items: center; background: linear-gradient(160deg, #f3f6fb, #dde3ea); -webkit-font-smoothing: antialiased; font-family: system-ui; }
    .wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
    img { width: 96px; height: 96px; filter: drop-shadow(0 6px 14px rgba(11,87,208,.28)); }
    h1 { margin: 0; font: 600 30px/1.1 system-ui; color: #1f1f1f; letter-spacing: -.3px; }
    p { margin: 0; font: 400 17px system-ui; color: #444746; }
  </style><div class="wrap"><img src="${icon128}" alt=""><h1>More Tab Actions</h1><p>More from your tab menu</p></div>`);
  await render.goto(`file://${file}`);
  await render.screenshot({ path: path.join(store, 'promo-440x280.png') });
  console.log('store/promo-440x280.png');
}
await browser.close();
await rm(tmp, { recursive: true, force: true });
