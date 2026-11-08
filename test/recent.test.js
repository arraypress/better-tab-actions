/**
 * "Switch to last used tab": the recent list, and which tab it picks across windows.
 *
 * @module test/recent
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { forget, lastUsed, noteUsed } from '../extension/background/recent.js';

/**
 * @param {number} id - The tab.
 * @param {number} [windowId] - Its window. Default 1.
 * @param {number} [lastAccessed] - When Chrome last activated it. Default 0.
 */
const tab = (id, windowId = 1, lastAccessed = 0) => ({ id, windowId, lastAccessed });

test('switching back and forth flips between the two most recent tabs', () => {
  /** @type {number[]} */
  let list = [];
  list = noteUsed(list, 1); // on tab 1
  list = noteUsed(list, 2); // then tab 2
  const tabs = [tab(1), tab(2), tab(3)];
  assert.equal(lastUsed(list, 2, tabs)?.id, 1);
  list = noteUsed(list, 1); // the shortcut switched to 1 (onActivated fires)
  assert.equal(lastUsed(list, 1, tabs)?.id, 2, 'pressed again, it goes back');
});

test('works across windows: a window focus change counts as using that window\'s tab', () => {
  // Tab 10 in window A, tab 20 in window B. Chrome's lastAccessed never changes on a window
  // switch, so it would say tab 30 (activated most recently inside its window) instead.
  const tabs = [tab(10, 1, 100), tab(20, 2, 200), tab(30, 2, 300)];
  const list = noteUsed(noteUsed([], 20), 10); // focused window B (20), then window A (10)
  assert.equal(lastUsed(list, 10, tabs)?.id, 20);
});

test('skips closed tabs, and the tab you are on', () => {
  const list = forget(noteUsed(noteUsed(noteUsed([], 3), 2), 1), 2); // 2 was closed
  assert.equal(lastUsed(list, 1, [tab(1), tab(3)])?.id, 3);
  assert.equal(lastUsed([1], 1, [tab(1)]), null, 'nowhere to go');
});

test('with no history yet (fresh start), falls back to Chrome\'s lastAccessed', () => {
  const tabs = [tab(1, 1, 50), tab(2, 1, 900), tab(3, 2, 400)];
  assert.equal(lastUsed([], 1, tabs)?.id, 2);
});

test('the list stays short and ignores bad ids', () => {
  /** @type {number[]} */
  let list = [];
  for (let id = 0; id < 50; id++) list = noteUsed(list, id);
  assert.equal(list.length, 20);
  assert.deepEqual(noteUsed([1, 2], -1), [1, 2]);
  assert.deepEqual(noteUsed([1, 2], undefined), [1, 2]);
});

test('each press records both ends, so pressing again comes back even if Chrome missed an event', () => {
  // As switchToLastUsed does: note the tab being left, pick, then note the tab switched to.
  /**
   * @param {number[]} list - The recent list.
   * @param {number} current - The tab the shortcut is pressed on.
   * @param {ReturnType<typeof tab>[]} tabs - The open tabs.
   */
  const press = (list, current, tabs) => {
    const before = noteUsed(list, current);
    const target = lastUsed(before, current, tabs);
    assert.ok(target, 'somewhere to go');
    return { list: noteUsed(before, target.id), target: target.id };
  };
  const tabs = [tab(1), tab(2), tab(3)];
  const list = [2]; // only ever saw tab 2 (focus events missed for tab 1's window)
  let step = press(list, 1, tabs);
  assert.equal(step.target, 2);
  step = press(step.list, 2, tabs);
  assert.equal(step.target, 1, 'back to where we started');
});
