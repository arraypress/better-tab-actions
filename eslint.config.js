/**
 * ESLint's settings: the recommended rules plus no `var`, `const` where nothing reassigns, and
 * no unused variables, over the extension, tests, scripts and store tools (not the kit's copy).
 *
 * @module eslint.config
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'release/', '.test-builds/', 'extension/vendor/', '**/*.d.ts'] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } },
    rules: { 'no-var': 'error', 'prefer-const': 'error', 'no-unused-vars': 'error' },
  },
];
