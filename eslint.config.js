import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Token hygiene is enforced in two layers: this lint rule (static) and the
 * runtime sentinel harness in scripts/token-hygiene.mjs (dynamic). Neither is
 * sufficient alone — a grep for `console.` misses process.stdout.write and
 * error serialization, which is why the sentinel harness exists.
 */
const tokenHandlingPaths = [
  'packages/core/src/**/*.ts',
  'packages/*/src/server/**/*.ts',
  'api/**/*.ts',
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Code that can hold a token must never write to the console, and must not
    // pull in a request logger that would serialize headers.
    files: tokenHandlingPaths,
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'hono/logger',
              message: 'Request logging can serialize Authorization headers. Do not use it.',
            },
          ],
        },
      ],
    },
  },
  {
    // Build and verification scripts run in Node and are expected to report.
    files: ['**/*.mjs', '**/*.config.ts', '**/scripts/**', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
);
