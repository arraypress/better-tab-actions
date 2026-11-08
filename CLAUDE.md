# CLAUDE.md — More Tab Actions

MV3 extension: extra actions in Chrome's tab right-click menu (`shared/actions.js`, `background/background.js`), with
an options page (`options/`). The extension is `extension/` (paths below are inside it unless they say otherwise);
the repo around it holds the tests, scripts, store assets and docs. Settings (`shared/settings.js`) always live in `chrome.storage.sync`, so they
follow the user through their own Chrome Sync (plain preferences, not personal data; the developer
receives nothing); `chrome.storage.local` only holds a write sync refused, until it's retried. The
options page debounces its writes (sync allows 120 a minute). `background/migrate.js` moves older installs'
settings (local, plus the old opt-in sync switch) into sync; the background runs it on install and startup.
The About card's links are in `options/about-links.js` (placeholders until the domain is chosen; `npm run package`
warns loudly while any remain). `npm test` (node --test), `npm run package` (tests, kit check, zip, link warning),
`npm run e2e` (Playwright checks in real Chromium, `test/e2e/`: the group actions, the options page and the toolbar glyph; not part of `npm test`).
`test/package.test.js` checks the zip is exactly `extension/` (less the SVG sources) and that every path the extension names resolves inside it.

Toolbar glyph: `action.default_icon` is a light/dark glyph (`icons/toolbar/`, `npm run toolbar-icons`); `background/toolbar-theme.js` swaps it on reports from `shared/toolbar-scheme.js` (options page, and `offscreen/offscreen.html` kept open with reason MATCH_MEDIA, polling as offscreen pages get no `change` events), key `toolbarDark` in local, never synced; `test/e2e/toolbar.mjs`. `setIcon` paths start with `/` (from the extension's root), as Chrome resolves them against the worker's address, which is now `background/`.

## Design
- The options page copies chrome://settings. Its look comes from the shared kit
  `../Extensions/_chrome-ui/chrome-ui.css`, shipped here as `extension/shared/chrome-ui.css` (never edit the copy:
  edit the kit, run `node ../Extensions/_chrome-ui/sync.mjs`; `npm run package` fails while the copy
  is out of date). Class names are in `../Extensions/_chrome-ui/README.md`.
- Never hand-roll styles for things the kit has (rows, cards, toggles, selects, buttons, link rows).
  `options/options.css` holds only what this page adds.
- One card per section, section titles above cards, help as a row's secondary text, links to
  Chrome pages as link rows (`.link-row.external`).
- The About card comes last and copies chrome://settings/help (Chromium's `settings/about_page`):
  logo and name, "Version …", then "Get help with …", "Report an issue", "Privacy policy" as external
  link rows. Its two layout rules (logo spacing, 20px title) are in `options/options.css`, as the kit has no
  About row yet.

## Wording
Tabby's rules (`../Extensions/tabby/CLAUDE.md`, "Wording"): Chrome's own words, sentence case, curly
quotes and apostrophes, "…" only when something asks for more input.

## Folders
- GitHub: `arraypress/more-tab-actions` (private for now). The About links (`extension/options/about-links.js`) point into it, so make it public before the store listing goes live.
- Playwright is a devDependency (`npm install`); the design kit (`../Extensions/_chrome-ui`) is optional: `check-ui` and `toolbar-icons` skip or explain when it isn't next door.
- **Load the `extension/` folder** (chrome://extensions → Load unpacked). `npm run package` writes the store zip to `release/more-tab-actions.zip`: exactly `extension/`, less `icons/**/*.svg` and `.DS_Store` (`scripts/package.mjs`). `docs/bug-report/` is the Chrome separator-bug write-up.
- Where a file goes: `background/` runs only in the service worker, `offscreen/` and `options/` are those pages, and `shared/` is what more than one of them loads (`actions.js` and what it imports are loaded by the worker and the options page).
- `store/`: Chrome Web Store screenshots and promo tile (listing text in `CHROMEWEBSTORE.md`). Not packaged. Regenerate with `node store/tools/make-screenshots.mjs`.
