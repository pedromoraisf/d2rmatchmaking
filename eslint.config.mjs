// Root ESLint flat config. Workspaces extend it from their own eslint.config.mjs.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/target/**',
      '**/reports/**',
      '.claude/skills/tlc-spec-driven/**',
      'apps/agent/src-tauri/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use a union of string literals instead of enum.' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Harness scripts and hooks are plain Node ESM and talk to the terminal.
    files: ['scripts/**/*.mjs', '.claude/hooks/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // Domain code is pure: no clocks, randomness or I/O — inject Clock / IdGenerator ports instead.
    files: ['apps/api/src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'setTimeout', 'setInterval', 'process'],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject the Clock port.' },
        { object: 'Math', property: 'random', message: 'Inject the IdGenerator / Random port.' },
      ],
    },
  },
  prettier,
);
