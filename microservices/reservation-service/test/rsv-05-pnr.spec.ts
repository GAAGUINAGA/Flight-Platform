import { expect, it } from '@jest/globals';
import { createPnr, generatePnr, PNR_ALPHABET } from '../src/domain/pnr';
describe('RSV-05: PNR', () => {
  it('RSV-05 / U: genera seis caracteres no ambiguos', () => { const pnr = createPnr(); expect(pnr).toHaveLength(6); expect([...pnr].every((character) => PNR_ALPHABET.includes(character))).toBe(true); });
  it('RSV-05 / I: 10 000 PNR no colisionan persistidos', async () => { const persisted = new Set<string>(); let seed = 42; const random = () => { seed = (seed * 48_271) % 2_147_483_647; return seed / 2_147_483_647; }; for (let index = 0; index < 10_000; index += 1) persisted.add(await generatePnr(async (pnr) => persisted.has(pnr), random)); expect(persisted.size).toBe(10_000); });
});
