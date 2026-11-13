/**
 * Test builds only (scripts/build-e2e.mjs): the service worker's script, so the e2e checks can
 * call exactly what a menu click and a keyboard shortcut call. Chrome's native tab menu and
 * shortcuts can't be driven headlessly; the store build has no such door (test/package.test.js).
 *
 * @module test/e2e/hook
 */
import { handleCommand, handleMenuClick } from './background/background.js';

/**
 * What the hook puts on the worker's globalThis, as `betterTabActionsTest`.
 *
 * @typedef {object} TestHook
 * @property {typeof handleMenuClick} click What a click in the tab menu calls.
 * @property {typeof handleCommand} command What a keyboard shortcut calls.
 */

/** @type {TestHook} */
const hook = { click: handleMenuClick, command: handleCommand };
Object.assign(globalThis, { betterTabActionsTest: hook });
