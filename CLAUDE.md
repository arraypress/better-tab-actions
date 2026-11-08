# CLAUDE.md — More Tab Actions

MV3 extension: extra actions in Chrome's tab right-click menu (`actions.js`, `background.js`), with
an options page (`options.*`). Settings (`settings.js`) always live in `chrome.storage.sync`, so they
follow the user through their own Chrome Sync (plain preferences, not personal data; the developer
receives nothing); `chrome.storage.local` only holds a write sync refused, until it's retried. The
options page debounces its writes (sync allows 120 a minute). `migrate.js` moves older installs'
settings (local, plus the old opt-in sync switch) into sync; the background runs it on install and startup.
The About card's links are in `about-links.js` (placeholders until the domain is chosen; `npm run package`
warns loudly while any remain). `npm test` (node --test), `npm run package` (tests, kit check, zip, link warning),
`npm run e2e` (Playwright checks in real Chromium, `e2e/`: the group actions, and the options page; not part of `npm test`).

Toolbar glyph: `action.default_icon` is a light/dark glyph (`icons/toolbar/`, `npm run toolbar-icons`); `toolbar-theme.js` swaps it on reports from `toolbar-scheme.js` (options page, and `offscreen.html` kept open with reason MATCH_MEDIA, polling as offscreen pages get no `change` events), key `toolbarDark` in local, never synced; `e2e/toolbar.mjs`.

## Design
- The options page copies chrome://settings. Its look comes from the shared kit
  `../Extensions/_chrome-ui/chrome-ui.css`, shipped here as `chrome-ui.css` (never edit the copy:
  edit the kit, run `node ../Extensions/_chrome-ui/sync.mjs`; `npm run package` fails while the copy
  is out of date). Class names are in `../Extensions/_chrome-ui/README.md`.
- Never hand-roll styles for things the kit has (rows, cards, toggles, selects, buttons, link rows).
  `options.css` holds only what this page adds.
- One card per section, section titles above cards, help as a row's secondary text, links to
  Chrome pages as link rows (`.link-row.external`).
- The About card comes last and copies chrome://settings/help (Chromium's `settings/about_page`):
  logo and name, "Version …", then "Get help with …", "Report an issue", "Privacy policy" as external
  link rows. Its two layout rules (logo spacing, 20px title) are in `options.css`, as the kit has no
  About row yet.

## Wording
Tabby's rules (`../Extensions/tabby/CLAUDE.md`, "Wording"): Chrome's own words, sentence case, curly
quotes and apostrophes, "…" only when something asks for more input.

## Folders
- GitHub: `arraypress/more-tab-actions` (private for now). The About links (`about-links.js`) point into it, so make it public before the store listing goes live.
- Playwright is a devDependency (`npm install`); the design kit (`../Extensions/_chrome-ui`) is optional: `check-ui` and `toolbar-icons` skip or explain when it isn't next door.
- **Load this folder itself** (chrome://extensions → Load unpacked). `npm run package` writes the store zip to `release/more-tab-actions.zip`. `bug-report/` is the Chrome separator-bug write-up.
- `store/`: Chrome Web Store screenshots and promo tile (listing text in `CHROMEWEBSTORE.md`). Not packaged. Regenerate with `node store/tools/make-screenshots.mjs`.
