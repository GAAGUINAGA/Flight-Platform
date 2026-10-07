import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/generated/**', '**/prisma-client/**'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint },
    rules: { ...tseslint.configs.recommended.rules }
  },
  {
    files: ['**/src/domain/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@nestjs/*', '@prisma/*', '**/infrastructure/**'] }] }
  },
  {
    files: ['**/*.spec.ts'],
    languageOptions: { globals: { describe: 'readonly', it: 'readonly', expect: 'readonly', jest: 'readonly' } }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: 'readonly' } }
  }
];
