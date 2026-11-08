/**
 * The options page's look comes from a shared design kit kept outside this repo
 * (../Extensions/_chrome-ui), copied here as extension/shared/chrome-ui.css. When the kit is
 * next door, make sure the copy is current; in a standalone clone, there's nothing to
 * compare against, so say so and carry on.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const kitCheck = fileURLToPath(new URL('../../Extensions/_chrome-ui/check.mjs', import.meta.url));
const copy = fileURLToPath(new URL('../extension/shared/chrome-ui.css', import.meta.url));
if (existsSync(kitCheck)) {
  execFileSync('node', [kitCheck, copy], { stdio: 'inherit' });
} else {
  console.log('Design kit not found next to this repo: skipping the chrome-ui.css freshness check.');
}
