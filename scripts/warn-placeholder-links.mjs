/**
 * Warns, loudly, while any About link is still a placeholder (about-links.js), so a build with
 * example.com links can't ship by accident. Run by `npm run package`, after the zip is made: the
 * zip is still fine for testing, just not for the store.
 */
import { fileURLToPath } from 'node:url';
import { ABOUT_LINKS, isPlaceholder, REPOSITORY } from '../about-links.js';

/** The warning to print, or null when every link is real. */
export function placeholderWarning(links = ABOUT_LINKS) {
  const left = Object.entries(links).filter(([, url]) => isPlaceholder(url));
  if (!left.length) return null;
  const bar = '!'.repeat(78);
  return [
    bar,
    '!! WARNING: the About card still has placeholder links (about-links.js):',
    ...left.map(([name, url]) => `!!   ${name}: ${url}`),
    '!! Don’t submit this zip to the Chrome Web Store. Set the real URLs and rerun `npm run package`.',
    bar,
  ].join('\n');
}

/** The links point at the GitHub repo: it has to be public before the store listing goes live. */
export function repositoryReminder(links = ABOUT_LINKS) {
  const onGitHub = Object.values(links).some((url) => url.startsWith(REPOSITORY));
  return onGitHub
    ? `Reminder: the About links point at ${REPOSITORY}. Make the repository public before submitting to the Chrome Web Store.`
    : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const warning = placeholderWarning();
  if (warning) console.warn(`\n${warning}\n`);
  const reminder = repositoryReminder();
  if (reminder) console.log(`\n${reminder}\n`);
}
