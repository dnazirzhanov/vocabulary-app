import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'dist-auth', 'screenshots'] },
  { ignores: ['test-results', 'playwright-report'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // React rules only where React lives (Playwright fixtures also call a function named `use`).
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // All text lives in src/i18n (ADR 0055): a Russian string anywhere else would stay Russian for everyone.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/i18n/**', 'src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['Literal', 'JSXText', 'TemplateElement[value.raw]'].map((node) => ({
          selector: `${node.split('[')[0]}[${node === 'TemplateElement[value.raw]' ? 'value.raw' : 'raw'}=/[\\u0400-\\u04FF]/]`,
          message: 'Text belongs in src/i18n/ru.ts, read through `t`.',
        })),
      ],
    },
  },
  {
    // End-to-end tests and their config run in Node.
    files: ['e2e/**', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Node scripts; functions passed to page.evaluate() run in the browser.
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
