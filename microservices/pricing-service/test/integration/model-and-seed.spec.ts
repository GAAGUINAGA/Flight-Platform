import { afterAll, beforeAll, expect, it } from '@jest/globals';
import process from 'node:process';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { seed } from '../../prisma/seed';

describe('PRC-02/03: modelo y seed de Pricing', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    // La CI/clon limpio inyecta DATABASE_URL. La prueba no lee archivos .env.
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Pricing integration tests');
    prisma = new PrismaClient();
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it('PRC-02: la migración crea fares, offers, price_locks y change_offers en pricing', async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'pricing' AND table_name <> '_prisma_migrations'`;
    expect(tables.map((table) => table.table_name).sort()).toEqual(['change_offers', 'fares', 'offers', 'price_locks']);
  });

  it('PRC-03: el seed conserva las tres brands de cada ruta de Inventory y es idempotente', async () => {
    expect(await seed(prisma)).toBeGreaterThan(14 * 55);
    const fares = await prisma.fare.findMany({ select: { flightInstanceId: true, cabinClass: true, brand: true } });
    const brandsByFlight = new Map<string, Set<string>>();
    for (const fare of fares) {
      const brands = brandsByFlight.get(fare.flightInstanceId) ?? new Set<string>();
      brands.add(`${fare.cabinClass}:${fare.brand}`);
      brandsByFlight.set(fare.flightInstanceId, brands);
    }
    const expectedBrands = ['ECONOMY:BASIC', 'ECONOMY:CLASSIC', 'BUSINESS:FLEX'];
    const seededGroups = [...brandsByFlight.values()].filter((brands) => expectedBrands.every((brand) => brands.has(brand)));
    // Puede haber tarifas de otras pruebas; cada grupo completo corresponde a una instancia del seed de Inventory.
    expect(seededGroups.length).toBeGreaterThan(14 * 55);
    const count = await prisma.fare.count();
    await seed(prisma);
    expect(await prisma.fare.count()).toBe(count);
  });
});
