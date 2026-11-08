/* global __dirname */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zoneOf } from '@flight-platform/shared';

// NFR-TI-01: todo origen o destino de los seeds (local y Supabase usan los mismos archivos) debe tener zona.
const seeds = ['inventory-service', 'pricing-service'].map((service) => join(__dirname, '..', '..', '..', service, 'prisma', 'seed.ts'));

describe('LD-08 cobertura de zonas de los seeds', () => {
  it.each(seeds)('%s: cada IATA de sus rutas tiene zona IANA', (file) => {
    const codes = new Set([...readFileSync(file, 'utf8').matchAll(/\b(?:from|to):\s*'([A-Z]{3})'/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThanOrEqual(6);
    expect([...codes].filter((iata) => !zoneOf(iata))).toEqual([]);
  });
});
