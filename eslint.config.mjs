import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

// Globales del navegador que usa la web (platform/web). Lista explícita: lo que no esté aquí es un error de lint.
const browserGlobals = Object.fromEntries([
  'window', 'document', 'fetch', 'crypto', 'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'RequestInfo', 'RequestInit', 'AbortController', 'AbortSignal',
  'setTimeout', 'clearTimeout', 'Event', 'KeyboardEvent', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLDivElement', 'Element',
  'DOMException', 'NodeFilter', 'getComputedStyle', 'Uint8Array', 'Document'
].map((name) => [name, 'readonly']));

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/generated/**', '**/prisma-client/**'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsParser, parserOptions: { sourceType: 'module', ecmaFeatures: { jsx: true } } },
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
  },
  // Web (F12c-2a): código de navegador. La app solo llega al backend por su capa de datos, y los paquetes compartidos no dependen de ella.
  {
    files: ['platform/web/**/*.ts', 'platform/web/**/*.tsx'],
    languageOptions: { globals: browserGlobals },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@nestjs/*', '@prisma/*', '@flight-platform/shared', '@flight-platform/contracts', '**/api-gateway/**', '**/platform/graphql/**'], message: 'La web no importa código del backend: solo los paquetes compartidos del front.' }] }],
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'Usa src/data/identity.ts (almacenamiento con respaldo en memoria).' }, { name: 'sessionStorage', message: 'Usa src/data/identity.ts.' }]
    }
  },
  {
    files: ['platform/web/test/**', 'platform/web/e2e/**', 'platform/web/**/*.test.ts', 'platform/web/**/*.test.tsx', 'platform/web/*.ts'],
    languageOptions: { globals: { __dirname: 'readonly' } }
  }
];
