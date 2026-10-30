import { readFileSync } from 'node:fs';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import eslintConfig from '../eslint.mjs';

// The expected configuration is written out literally on purpose: a rule dropped or relaxed in a preset must fail
// this file, so the test never derives its expectations from the presets it checks.

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as unknown;

describe('@d2rmm/config presets', () => {
  it('tsconfig.base.json keeps the strict compiler options and the two F0 additions', () => {
    const base = readJson('tsconfig.base.json') as { compilerOptions: unknown };
    expect(base.compilerOptions).toStrictEqual({
      target: 'ES2024',
      lib: ['ES2024'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noPropertyAccessFromIndexSignature: true,
      useUnknownInCatchVariables: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      declaration: true,
      sourceMap: true,
      rewriteRelativeImportExtensions: true,
      erasableSyntaxOnly: true,
    });
  });

  it('tsconfig.dom.json extends the base and adds the DOM libraries', () => {
    const dom = readJson('tsconfig.dom.json') as { extends: string; compilerOptions: unknown };
    expect(dom.extends).toBe('./tsconfig.base.json');
    expect(dom.compilerOptions).toStrictEqual({ lib: ['ES2024', 'DOM', 'DOM.Iterable'] });
  });

  it('prettier.json keeps the repository formatting options', () => {
    expect(readJson('prettier.json')).toStrictEqual({
      printWidth: 110,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
      arrowParens: 'always',
    });
  });

  it('package.json exports the four presets', () => {
    const pkg = readJson('package.json') as { exports: unknown };
    expect(pkg.exports).toStrictEqual({
      './tsconfig.base.json': './tsconfig.base.json',
      './tsconfig.dom.json': './tsconfig.dom.json',
      './eslint': './eslint.mjs',
      './prettier': './prettier.json',
    });
  });

  it('eslint keeps the plugin blocks by reference', () => {
    const pluginBlocks = [js.configs.recommended, ...tseslint.configs.strict, prettier];
    for (const block of pluginBlocks) {
      expect(eslintConfig).toContain(block);
    }
  });

  it('eslint keeps every repository rule, ignore and override unchanged', () => {
    const pluginBlocks = [js.configs.recommended, ...tseslint.configs.strict, prettier];
    const repositoryBlocks = eslintConfig.filter((block) => !pluginBlocks.includes(block));
    expect(repositoryBlocks).toStrictEqual([
      {
        ignores: [
          '**/node_modules/**',
          '**/dist/**',
          '**/coverage/**',
          '**/target/**',
          '**/reports/**',
          '.claude/skills/tlc-spec-driven/**',
          'apps/agent/src-tauri/**',
          '.claude/worktrees/**',
          '**/.features-gen/**',
          '**/.stryker-tmp/**',
          '**/.turbo/**',
        ],
      },
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
        files: ['scripts/**/*.mjs', '.claude/hooks/**/*.mjs'],
        rules: { 'no-console': 'off' },
      },
      {
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
    ]);
  });
});
