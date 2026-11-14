/* global __dirname */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regla del diseño F12c-0 §8: ningún paquete compartido del front importa DOM, NestJS ni React Native (ni `platform/*`).
 * Así la app React Native posterior reutiliza la misma lógica.
 */
const SHARED = ['design-tokens', 'brand', 'session', 'format'];
const list = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? list(path) : [path]; });
const sources = (pkg: string): string[] => list(join(__dirname, pkg, 'src')).filter((file) => file.endsWith('.ts'));
const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('paquetes compartidos del front · fronteras (F12c-2a)', () => {
  it.each(SHARED)('PKG-01 %s no importa DOM, NestJS, React, React Native ni platform/*', (pkg) => {
    for (const file of sources(pkg)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const imports = [...code.matchAll(/from\s+'([^']+)'|require\('([^']+)'\)/g)].map((match) => match[1] ?? match[2]);
      for (const specifier of imports) {
        expect(specifier).not.toMatch(/^(react|react-dom|react-native|@nestjs\/|node:|fs$|path$)/);
        expect(specifier).not.toMatch(/(^|\/)platform\//); // la carpeta platform/* (no el ámbito @flight-platform)
      }
      expect(code).not.toMatch(/\b(window|document|navigator|globalThis)\s*[.[]|\b(localStorage|sessionStorage|HTMLElement)\b/);
    }
  });

  it.each(SHARED)('PKG-02 %s compila sin la librería DOM ni tipos de Node (tsconfig)', (pkg) => {
    const config = JSON.parse(readFileSync(join(__dirname, pkg, 'tsconfig.json'), 'utf8')) as { compilerOptions: { lib: string[]; types: string[]; outDir: string } };
    expect(config.compilerOptions.lib).toEqual(['ES2022']);
    expect(config.compilerOptions.types).toEqual([]);
    expect(config.compilerOptions.outDir).toBe('dist');
  });

  it('PKG-03 los tipos y documentos generados de graphql-schema no importan nada de plataforma', () => {
    for (const file of list(join(__dirname, 'graphql-schema', 'generated'))) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      expect(imports.every((specifier) => specifier.startsWith('./'))).toBe(true);
    }
  });
});
