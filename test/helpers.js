/**
 * What more than one test file needs besides the fakes.
 *
 * @module test/helpers
 */

/**
 * Capture what's logged with `console.error` while `body` runs, and keep it off the test output.
 *
 * @param {() => Promise<unknown>} body - What to run.
 * @returns {Promise<string[]>} Each call's arguments, joined with a space.
 * @example
 * const logged = await errorsLogged(() => openWorkspace(apis, workspace, options));
 * assert.match(logged[0], /^Reopening a window:/);
 */
export async function errorsLogged(body) {
  const real = console.error;
  /** @type {string[]} */
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  try {
    await body();
  } finally {
    console.error = real;
  }
  return logged;
}
