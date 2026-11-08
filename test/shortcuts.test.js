import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../extension/shared/actions.js';
import { setShortcuts } from '../extension/options/shortcuts.js';

test('lists only the shortcuts that are set, in menu order', () => {
  const commands = ACTIONS.map((action) => ({ name: action.id, shortcut: '' }));
  commands.find((c) => c.name === 'mute-other-tabs').shortcut = '⌥⇧M';
  commands.find((c) => c.name === 'close-site-tabs').shortcut = '⌥⇧W';
  assert.deepEqual(setShortcuts(ACTIONS, commands).map((s) => [s.id, s.shortcut]), [
    ['close-site-tabs', '⌥⇧W'],
    ['mute-other-tabs', '⌥⇧M'],
  ]);
});

test('nothing set means an empty list (the page then shows only the link row)', () => {
  assert.deepEqual(setShortcuts(ACTIONS, ACTIONS.map((a) => ({ name: a.id }))), []);
  assert.deepEqual(setShortcuts(ACTIONS, []), []);
});

test('uses the action titles Chrome shows as shortcut descriptions', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const [first] = setShortcuts(ACTIONS, [{ name: 'close-site-tabs', shortcut: 'X' }]);
  assert.equal(first.title, manifest.commands['close-site-tabs'].description);
});
