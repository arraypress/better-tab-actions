/**
 * Where the About card's links go (options page, "About Better Tab Actions"):
 * the project's GitHub repository. It must be public before the extension is
 * published, or these links show GitHub's 404; `npm run package` reminds you.
 * Change them here only.
 *
 * @module options/about-links
 */

import { githubAboutLinks } from '../vendor/extension-kit/index.js';

/** The project's repository: README, Issues and PRIVACY.md live there. */
export const REPOSITORY = 'https://github.com/arraypress/better-tab-actions';

/** "Get help with Better Tab Actions", "Report an issue" and "Privacy policy". */
export const ABOUT_LINKS = githubAboutLinks(REPOSITORY);
