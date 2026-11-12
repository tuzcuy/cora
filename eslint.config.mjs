import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import requirePermission from './eslint-rules/require-permission.mjs';

export default tseslint.config(
  // Every API write route must be permission-guarded — a lint error, not a review note.
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { cora: { rules: { 'require-permission': requirePermission } } },
    rules: { 'cora/require-permission': 'error' },
  },
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/prisma/migrations/**',
      '**/*.config.{js,cjs,mjs,ts}',
      'apps/web/src/lib/api/schema.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
