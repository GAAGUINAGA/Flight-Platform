/* global require */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { knownOperations } from './index.cjs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generate, outDir } = require('./scripts/codegen.cjs') as { generate: () => Record<string, string>; outDir: string };

describe('graphql-schema · codegen (F12c-2a)', () => {
  it('GQS-CG-01 los archivos generados no tienen cambios pendientes respecto del SDL y las operaciones', () => {
    for (const [name, content] of Object.entries(generate())) expect(readFileSync(join(outDir, name), 'utf8')).toBe(content);
  });

  it('GQS-CG-02 cada operación conocida tiene su documento tipado con el texto canónico', () => {
    const operations = readFileSync(join(outDir, 'operations.ts'), 'utf8'); const types = readFileSync(join(outDir, 'types.ts'), 'utf8');
    const known = knownOperations();
    expect(known.size).toBeGreaterThanOrEqual(28);
    for (const [name, text] of known) {
      expect(operations).toContain(`export const ${name}Operation:`);
      expect(operations).toContain(JSON.stringify(text));
      expect(types).toMatch(new RegExp(`export type ${name}(Query|Mutation)Variables = `));
    }
  });

  it('GQS-CG-03 los tipos generados compilan en modo estricto y los escalares de dinero y fecha son cadenas', () => {
    const files = ['types.ts', 'operations.ts'].map((name) => join(outDir, name));
    const program = ts.createProgram(files, { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, isolatedModules: true, types: [] });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    expect(diagnostics).toEqual([]);
    const types = readFileSync(files[0], 'utf8');
    expect(types).toContain('export type MoneyFieldsFragment = { currency: string; total: string; baseFare: string | null; taxes: string | null };');
    expect(types).toContain("export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';");
    expect(types).toContain('export interface ItineraryQueryInput { origin: string; destination: string; departureDate: string }');
    expect(types).not.toMatch(/\bany\b/);
  });
});
