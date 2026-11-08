/* global require */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';

// ADR-F12b1fix-02: script de corrección de operational_flights.date (solo toca las filas creadas por esta prueba).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const script = require(join(process.cwd(), 'scripts/local-platform/fix-operational-flight-dates.cjs')) as {
  affected(db: unknown, prefix?: string): Promise<Array<{ id: string; flight_number: string; old_date: string; new_date: string; conflict: boolean }>>;
  apply(db: unknown, prefix?: string): Promise<{ rows: unknown[]; updated: number }>;
};

describe('LD-T6 script de corrección de operational_flights.date', () => {
  let prisma: PrismaClient;
  const tag = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
  const mk = (suffix: string, origin: string, departure: string, date: string) => ({
    flightInstanceId: randomUUID(), flightNumber: `Q${tag}${suffix}`.slice(0, 8), date, marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: origin, arrivalIata: 'MAD',
    scheduledDepartureAt: new Date(departure), scheduledArrivalAt: new Date(new Date(departure).getTime() + 3_600_000), status: 'SCHEDULED'
  });
  const rows = [
    mk('1', 'LIM', '2030-06-11T03:30:00Z', '2030-06-11'), // local 10 → se corrige
    mk('2', 'UIO', '2030-06-11T00:00:00Z', '2030-06-11'), // local 10 → se corrige
    mk('3', 'MAD', '2030-06-11T10:00:00Z', '2030-06-11'), // ya correcta
    mk('4', 'QQQ', '2030-06-11T03:30:00Z', '2030-06-11'), // sin zona: UTC, ya correcta
    mk('5', 'UIO', '2030-06-12T00:00:00Z', '2030-06-12') // local 11 → choca con la fila siguiente
  ];
  const clash = mk('5', 'UIO', '2030-06-11T10:00:00Z', '2030-06-11'); // ya correcta y ocupa (número, 2030-06-11)
  const mine = (list: Array<{ flight_number: string }>) => list.filter((row) => row.flight_number.startsWith(`Q${tag}`));
  const cleanup = () => prisma.operationalFlight.deleteMany({ where: { flightNumber: { startsWith: `Q${tag}` } } });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Operations integration tests');
    prisma = new PrismaClient(); await prisma.$connect(); await cleanup();
  });
  afterAll(async () => { if (!prisma) return; try { await cleanup(); } finally { await prisma.$disconnect(); } });

  it('lista las afectadas con fecha vieja y nueva, aborta ante un choque de unicidad sin escribir, corrige y es idempotente', async () => {
    await prisma.operationalFlight.createMany({ data: [...rows, clash] });
    const prefix = `Q${tag}`; // limita el script a las filas de esta prueba
    const found = mine(await script.affected(prisma, prefix));
    expect(found.map((r) => [r.flight_number.slice(-1), r.old_date, r.new_date, r.conflict])).toEqual([
      ['1', '2030-06-11', '2030-06-10', false], ['2', '2030-06-11', '2030-06-10', false], ['5', '2030-06-12', '2030-06-11', true]
    ]);
    await expect(script.apply(prisma, prefix)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mine(await script.affected(prisma, prefix))).toHaveLength(3); // nada se escribió

    await prisma.operationalFlight.delete({ where: { flightInstanceId: clash.flightInstanceId } });
    const result = await script.apply(prisma, prefix);
    expect(result.updated).toBe(3);
    expect(mine(await script.affected(prisma, prefix))).toHaveLength(0);
    const stored = await prisma.operationalFlight.findMany({ where: { flightNumber: { startsWith: `Q${tag}` } }, orderBy: { flightNumber: 'asc' } });
    expect(stored.map((r) => r.date)).toEqual(['2030-06-10', '2030-06-10', '2030-06-11', '2030-06-11', '2030-06-11']);
    expect((await script.apply(prisma, prefix)).updated).toBe(0);
  });
});
