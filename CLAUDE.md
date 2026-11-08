# CLAUDE.md — More Tab Actions

MV3 extension: extra actions in Chrome's tab right-click menu (`shared/actions.js`, `background/background.js`), with
an options page (`options/`). The extension is `extension/` (paths below are inside it unless they say otherwise);
the repo around it holds the tests, scripts, store assets and docs. Settings (`shared/settings.js`: the schema
for `@arraypress/extension-kit`'s settings store) always live in `chrome.storage.sync`, so they
follow the user through their own Chrome Sync (plain preferences, not personal data; the developer
receives nothing); `chrome.storage.local` only holds a write sync refused, until it's retried (by the options
page, and by the worker at start). The options page debounces its writes (sync allows 120 a minute).
The About card's links are in `options/about-links.js` (`githubAboutLinks`; `npm run package`
warns loudly if one is ever a placeholder). `npm test` (node --test), `npm run package` (tests, zip, link reminders),
`npm run e2e` (Playwright checks in real Chromium, `test/e2e/`: the group actions, the options page and the toolbar glyph; not part of `npm test`).
`test/package.test.js` checks the zip is exactly `extension/` (less the SVG sources) and that every path the extension names resolves inside it.

Toolbar glyph: `action.default_icon` is a light/dark glyph (`icons/toolbar/`, `npm run toolbar-icons`). The kit does the work: `startToolbarTheme(chrome)` in the worker, `watchColorScheme(chrome)` on the options page, `watchSchemeOffscreen` in `offscreen/` (kept open with reason MATCH_MEDIA, polling as offscreen pages get no `change` events), key `toolbarDark` in local, never synced; `test/e2e/toolbar.mjs` runs the kit's `checkToolbarTheme`.

`extension/vendor/extension-kit/` is `@arraypress/extension-kit`'s browser half, copied from `node_modules` by
`npm install` (`postinstall`) and never committed (gitignored), so it can't drift from `package.json`. Never edit it.

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
- GitHub: `arraypress/more-tab-actions` (private for now). The About links (`extension/options/about-links.js`) point into it, so make it public before the store listing goes live.
- `npm install` first: devDependencies (Playwright, the kit) and the kit's copy in `extension/vendor/`.
- **Load the `extension/` folder** (chrome://extensions → Load unpacked). `npm run package` writes the store zip to `release/more-tab-actions.zip`: exactly `extension/`, less `icons/**/*.svg`, `*.d.ts` and `.DS_Store` (`scripts/package.mjs`). `docs/bug-report/` is the Chrome separator-bug write-up.
- Where a file goes: `background/` runs only in the service worker, `offscreen/` and `options/` are those pages, `shared/` is what more than one of them loads (`actions.js` and what it imports are loaded by the worker and the options page), and `vendor/` is the kit's copy.
- `store/`: Chrome Web Store screenshots and promo tile (listing text in `CHROMEWEBSTORE.md`). Not packaged. Regenerate with `node store/tools/make-screenshots.mjs`.
