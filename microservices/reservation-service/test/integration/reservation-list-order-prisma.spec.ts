import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { ReservationQueries } from '../../src/application/queries';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaReservationStore } from '../../src/infrastructure/persistence/prisma-reservation-store';

/** RSV-LST (F12c-1, punto 0): orden más reciente primero y cursor compuesto (createdAt, id) con Postgres real, con 5 reservas de la MISMA fecha de creación en el borde de varias páginas. */
const pnr = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[randomInt(0, 24)]).join('');
describe('RSV-LST: ListReservations ordenada por fecha con Prisma real', () => {
  let prisma: PrismaClient; let queries: ReservationQueries; const owner = `owner-${randomUUID()}`; const created: string[] = []; let expected: string[] = [];
  const walk = async (limit: number, extra: { createdFrom?: string } = {}) => { const ids: string[] = []; const sizes: number[] = []; let cursor: string | undefined; for (let pages = 0; pages < 30; pages += 1) { const page = await queries.list({ ownerId: owner, limit, ...(cursor ? { cursor } : {}), ...extra }); sizes.push(page.items.length); ids.push(...page.items.map((item) => item.bookingId)); cursor = page.nextCursor || undefined; if (!cursor) break; } return { ids, sizes }; };
  beforeAll(async () => {
    const env = join(process.cwd(), 'microservices', 'reservation-service', '.env'); if (!process.env.DATABASE_URL && existsSync(env)) process.loadEnvFile(env);
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Reservation list-order integration tests');
    prisma = new PrismaClient(); await prisma.$connect(); const store = new PrismaReservationStore(prisma); queries = new ReservationQueries(store);
    const stamps = [...[9, 8].map((hour) => new Date(Date.UTC(2026, 10, 12, hour))), ...Array.from({ length: 5 }, () => new Date(Date.UTC(2026, 10, 12, 7))), ...[6, 5].map((hour) => new Date(Date.UTC(2026, 10, 12, hour)))];
    const rows: Array<{ id: string; at: Date }> = [];
    for (const at of stamps) {
      const id = randomUUID(); created.push(id); rows.push({ id, at });
      await store.create({ id, ownerId: owner, pnr: pnr(), status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `pay_ok_${id}`, idempotencyKey: `lst-${id}`, passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '1.00' }, changes: [{ changedAt: at.toISOString(), description: 'CREATED' }], attempts: 0 });
      await prisma.reservation.update({ where: { id }, data: { createdAt: at } });
    }
    expected = [...rows].sort((left, right) => right.at.getTime() - left.at.getTime() || (left.id < right.id ? 1 : -1)).map((row) => row.id);
  }, 60_000);
  afterAll(async () => { try { await prisma?.reservation.deleteMany({ where: { id: { in: created } } }); } finally { await prisma?.$disconnect(); } });

  it.each([1, 2, 3, 4, 9])('RSV-LST-01: limit=%i recorre las 9 de la más reciente a la más antigua, en orden exacto, sin repetir ni saltar (5 con la misma fecha)', async (limit) => {
    const { ids, sizes } = await walk(limit); expect(ids).toEqual(expected); expect(sizes.every((size) => size <= limit)).toBe(true);
  });
  it('RSV-LST-02: el cursor compuesto convive con el filtro por fechas de creación', async () => {
    const { ids } = await walk(2, { createdFrom: new Date(Date.UTC(2026, 10, 12, 7)).toISOString() }); expect(ids).toEqual(expected.slice(0, 7));
  });
  it('RSV-LST-03: un cursor inválido (o con forma válida pero un id que no es uuid) es VALIDATION_FAILED, no un error interno', async () => {
    await expect(queries.list({ ownerId: owner, limit: 2, cursor: 'xx' })).rejects.toThrow('VALIDATION_FAILED');
    const forged = Buffer.from(`${new Date().toISOString()}|no-uuid`).toString('base64url'); await expect(queries.list({ ownerId: owner, limit: 2, cursor: forged })).rejects.toThrow('VALIDATION_FAILED');
  });
});
