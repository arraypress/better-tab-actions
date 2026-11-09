# CLAUDE.md — More Tab Actions

MV3 extension: extra actions in Chrome's tab right-click menu (`shared/actions.js`, `background/background.js`), with
an options page (`options/`). The extension is `extension/` (paths below are inside it unless they say otherwise);
the repo around it holds the tests, scripts, store assets and docs. Settings (`shared/settings.js`: the schema
for `@arraypress/extension-kit`'s settings store) always live in `chrome.storage.sync`, so they
follow the user through their own Chrome Sync (plain preferences, not personal data; the developer
receives nothing); `chrome.storage.local` holds the saved workspaces (below) and a write sync refused, until it's retried (by the options
page, and by the worker at start). The options page debounces its writes (sync allows 120 a minute).
The About card's links are in `options/about-links.js` (`githubAboutLinks`; `npm run package`
warns loudly if one is ever a placeholder). `npm test` (ESLint; `tsc`, a strict check of the JSDoc types;
node --test; and `extension-kit duplication`, which fails on copied code not listed in `.jscpd-allowlist.json`), `npm run package` (tests, zip, link reminders),
`npm run e2e` (Playwright checks in real Chromium, `test/e2e/`: the group actions, workspaces, automatic closing, the options page and the toolbar glyph; not part of `npm test`).
`test/package.test.js` checks the zip is exactly `extension/` (less the SVG sources) and that every path the extension names resolves inside it.

Toolbar glyph: `action.default_icon` is a light/dark glyph (`icons/toolbar/`, `npm run toolbar-icons`). The kit does the work: `startToolbarTheme(chrome)` in the worker, `watchColorScheme(chrome)` on the options page, `watchSchemeOffscreen` in `offscreen/` (kept open with reason MATCH_MEDIA, polling as offscreen pages get no `change` events), key `toolbarDark` in local, never synced; `test/e2e/toolbar.mjs` runs the kit's `checkToolbarTheme`.

`extension/vendor/extension-kit/` is `@arraypress/extension-kit`'s browser half, copied from `node_modules` by
`npm install` (`postinstall`) and never committed (gitignored), so it can't drift from `package.json`. Never edit it.

## Workspaces
`shared/workspaces.js` (snapshot, name, reopen plan, storage, open/save/replace), wired into `shared/actions.js`
(actions `save-workspace`, `save-window-workspace`, `open-workspace`: a submenu of the latest 10 plus
"Manage workspaces", or the latest one from its shortcut), and `options/workspaces-section.js` (the card, ⋮ menu
via `options/action-menu.js`, rename dialog, toasts with Undo). Stored under `workspaces` in `chrome.storage.local`
only (it's browsing history: never sync), bounded to 40 workspaces × 500 tabs × 200 KB, URLs ≤ 8,192 characters,
titles ≤ 200. There's no save confirmation beyond what the extension already does for its actions: the menu
updates (the new workspace heads "Open workspace", as "Reopen 3 closed tabs" appears after closing), like Chrome's
own "Bookmark all tabs" shows nothing after saving.

What real Chromium does (checked with Playwright's Chromium 156, `test/e2e/workspaces.mjs`):
- **Opening tabs.** `chrome.tabs.create` refuses `javascript:`, `devtools:`, `chrome-untrusted:` and
  chrome://kill|crash|hang|quit|restart, and `file:` without file access. `view-source:`, `data:`, `about:`,
  extension pages and other chrome:// pages open fine, so they're kept (`reopenable()`); `blob:` and
  `chrome-error:` are skipped as there'd be nothing to show.
- **Unloaded tabs.** `chrome.tabs.discard` straight after `tabs.create` **loses the URL** (the tab stays blank
  for good). Waiting until the new tab reports its `url` (its navigation has started; ~20 ms) and then
  discarding keeps the URL, sends **no request**, and the tab loads when activated in a visible window.
  Discarding gives the tab a **new id**. So: each window opens with its active tab only, the rest are created,
  discarded that way, then grouped by their new ids.
- **Window state.** A state set right after tabs are added to a new window is dropped (reads back "normal" a
  moment later, headed too), so `setWindowState` sets it again until it holds. Bounds and a non-normal state
  can't be given together, so windows open normal at their bounds and change state last.
- **Saved tab groups.** Every group an extension makes is saved by Chrome and pinned to the saved groups bar
  (the profile's `Sync Data/LevelDB`, read by `test/e2e/saved-groups.mjs`). Closing its window or the browser
  keeps it; ungrouping or `tabs.remove` of its tabs deletes it. Nothing dedupes by title, and no API can find
  or reuse a closed saved group, so **each reopen of a workspace adds another saved copy of its groups**.
  Chosen: the synced setting **"Reopen tab groups"** (on by default, secondary text "Chrome also adds each group
  it reopens to your saved tab groups"): on keeps the workspace faithful, off reopens the tabs ungrouped and
  adds nothing. Reusing an open group with the same title was rejected: it would pull tabs into another window's
  group, and does nothing for the closed copies that pile up.

## Close unused tabs automatically
`background/auto-close.js`: an alarm (`close-unused-tabs`, every `CHECK_MINUTES` = 5) while `autoClose` is on
closes tabs `unused()` (shared with "Close tabs not used in N days" in `shared/actions.js`) for `autoCloseHours`
(1, 4, 12, 24, 72, 168; `AUTO_CLOSE_HOURS` in settings.js), in normal windows, never incognito, never on
`keepSites` (or their subdomains). Closed tabs are *appended* to the undo batch (`recordClosed(..., {append: true})`,
capped at 500) so earlier automatic closes stay reopenable; a menu action still starts a new batch. Sites are
typed into `options/text-dialog.js` (shared with "Rename workspace") and listed by `options/keep-sites.js`, as
chrome://settings/performance lists Memory Saver's sites; the list is cut to fit one sync item. Memory Saver is
only linked, never reimplemented.
- **Camera, mic, screen.** Chrome exposes no capture state to extensions: with fake devices in Chromium 156, a
  tab using `getUserMedia` (camera and mic) or `getDisplayMedia` showed no change in any `chrome.tabs.Tab` field
  (`audible` stays false), and `tabs.discard` didn't refuse it. Only a content script (host permissions) or
  `debugger`/`tabCapture` could tell, so it isn't attempted; the README says to list a call's site.
- **`alarms`** has no install warning: `test/e2e/auto-close.mjs` compares Chrome's own warnings for the manifest
  with and without it. That check runs on a test build (`.test-builds/auto-close/`, gitignored, deleted after)
  where `HOUR_MS` is a second and `CHECK_MINUTES` 0.02; unpacked extensions may set alarms that short.

## Design
- The options page copies chrome://settings. Its look comes from `chrome-ui.css` in `@arraypress/extension-kit`
  (`extension/vendor/extension-kit/styles/`). Class names are in the kit's README.
- Never hand-roll styles for things the kit has (rows, cards, toggles, selects, buttons, link rows).
  `options/options.css` holds only what this page adds.
- One card per section, section titles above cards, help as a row's secondary text, links to
  Chrome pages as link rows (`.link-row.external`).
- The About card comes last and copies chrome://settings/help (Chromium's `settings/about_page`):
  logo and name, "Version …", then "Get help with …", "Report an issue", "Privacy policy" as external
  link rows (the kit's `.about-product` and `.product-title`).

## Wording
Tabby's rules (`../Extensions/tabby/CLAUDE.md`, "Wording"): Chrome's own words, sentence case, curly
quotes and apostrophes, "…" only when something asks for more input.

## Folders
- GitHub: `arraypress/more-tab-actions` (public). The About links (`extension/options/about-links.js`) point into it, so it must stay public.
- `npm install` first: devDependencies (Playwright, the kit) and the kit's copy in `extension/vendor/`.
- **Load the `extension/` folder** (chrome://extensions → Load unpacked). `npm run package` writes the store zip to `release/more-tab-actions.zip`: exactly `extension/`, less `icons/**/*.svg`, `*.d.ts` and `.DS_Store` (`scripts/package.mjs`). `docs/bug-report/` is the Chrome separator-bug write-up.
- `test/e2e/helpers.mjs` holds what the e2e scripts share (made-up `*.example` sites with request counts, opening a window, running an action as a menu click does).
- Where a file goes: `background/` runs only in the service worker, `offscreen/` and `options/` are those pages, `shared/` is what more than one of them loads (`actions.js` and what it imports are loaded by the worker and the options page), and `vendor/` is the kit's copy.
- `store/`: Chrome Web Store screenshots and promo tile (listing text in `CHROMEWEBSTORE.md`). Not packaged. Regenerate with `node store/tools/make-screenshots.mjs`.
