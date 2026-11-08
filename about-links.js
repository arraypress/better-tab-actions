/**
 * Where the About card's links go (options page, "About More Tab Actions"): the project's GitHub
 * repository. The repository must be public before the extension is published, or these links
 * show GitHub's 404; `npm run package` reminds you (scripts/warn-placeholder-links.mjs).
 * Change them here only.
 */
export const REPOSITORY = 'https://github.com/arraypress/more-tab-actions';

export const ABOUT_LINKS = Object.freeze({
  /** "Get help with More Tab Actions": the README. */
  help: `${REPOSITORY}#readme`,
  /** "Report an issue": GitHub Issues. */
  reportIssue: `${REPOSITORY}/issues`,
  /** "Privacy policy": PRIVACY.md. */
  privacyPolicy: `${REPOSITORY}/blob/main/PRIVACY.md`,
});

/** Hosts reserved for examples (RFC 2606): a link to one is a placeholder. */
export const isPlaceholder = (url) => /(^|\.)example\.(com|org|net)$/.test(new URL(url).hostname);
