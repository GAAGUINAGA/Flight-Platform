import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { decodeListCursor, encodeListCursor, InMemoryReservationStore, StoredReservation } from '../src/application/reservation-store';
import { composeReservation } from '../src/infrastructure/grpc/reservation-composition';
import { createReservationServer, findProtoRoot } from '../src/infrastructure/grpc/server';

/**
 * RSV-15 (F12c-1, punto 0): «mis reservas» va de la más reciente a la más antigua con un cursor compuesto (fecha de creación + bookingId).
 * Incluye reservas con LA MISMA fecha de creación en el borde de una página: no deben repetirse ni saltarse.
 */
const key = 's'.repeat(40);
type Page = { items: Array<{ bookingId: string }>; nextCursor?: string };
type Client = { listReservations(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: Page) => void): void; close(): void };
const stub = new Proxy({}, { get: () => () => { throw new Error('not used'); } }) as never;

describe('RSV-15: ListReservations ordena por fecha de creación (desc) con cursor compuesto', () => {
  let app: INestMicroservice; let client: Client; const store = new InMemoryReservationStore(); let expected: string[] = [];
  const metadata = () => { const value = new Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', 'owner-A'); value.set('x-role', 'customer'); return value; };
  const list = (request: object) => new Promise<Page>((resolve, reject) => client.listReservations(request, metadata(), (error, response) => error ? reject(error) : resolve(response)));
  const walk = async (limit: number) => { const sizes: number[] = []; const ids: string[] = []; let cursor: string | undefined; for (let pages = 0; pages < 30; pages += 1) { const response = await list({ page: { limit, ...(cursor ? { cursor } : {}) } }); sizes.push(response.items.length); ids.push(...response.items.map((item) => item.bookingId)); cursor = response.nextCursor || undefined; if (!cursor) break; } return { sizes, ids }; };

  beforeAll(async () => {
    // 3 recientes distintas, 5 con EXACTAMENTE la misma fecha (cruzan el borde de página para limit 2, 3 y 4) y 3 antiguas distintas.
    const stamps = [...[9, 8, 7].map((hour) => new Date(Date.UTC(2026, 10, 12, hour))), ...Array.from({ length: 5 }, () => new Date(Date.UTC(2026, 10, 12, 6))), ...[5, 4, 3].map((hour) => new Date(Date.UTC(2026, 10, 12, hour)))];
    const rows: Array<{ id: string; at: Date }> = [];
    for (const [index, at] of stamps.entries()) {
      const id = randomUUID(); rows.push({ id, at });
      const value: StoredReservation = { id, ownerId: 'owner-A', pnr: `Q${String(index).padStart(5, '0')}`, status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `pay_ok_${id}`, idempotencyKey: randomUUID(), passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '10.00' }, changes: [{ changedAt: at.toISOString(), description: 'CONFIRMED' }], attempts: 0 };
      await store.create(value); store.createdAt.set(id, at);
    }
    // Orden esperado: fecha desc; empate por bookingId desc.
    expected = [...rows].sort((left, right) => right.at.getTime() - left.at.getTime() || (left.id < right.id ? 1 : -1)).map((row) => row.id);
    const deps = composeReservation({ store, pricing: stub, payment: stub, ancillaries: stub, inventory: stub, ticketing: stub, events: stub, operations: stub, quotes: stub, clock: { now: () => new Date() } as never, cutoffHours: 4, holdTtlMinutes: 20, validateResponse: () => undefined });
    const port = 39900 + Math.floor(Math.random() * 90);
    app = await createReservationServer({ url: `127.0.0.1:${port}`, internalApiKey: key, deps }); await app.listen();
    const definition = loadSync(`${findProtoRoot()}/flightplatform/reservation/v1/reservation.proto`, { includeDirs: [findProtoRoot()], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.reservation.v1.ReservationService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => { try { client?.close(); } finally { await app?.close(); } });

  it('RSV-15 / I: la primera página trae las más recientes primero', async () => {
    const first = await list({ page: { limit: 4 } }); expect(first.items.map((item) => item.bookingId)).toEqual(expected.slice(0, 4));
  });
  it.each([1, 2, 3, 4, 5, 11])('RSV-15 / I: limit=%i recorre las 11 en el orden exacto (más reciente primero), sin repetir ni saltar, aunque 5 compartan fecha de creación', async (limit) => {
    const { sizes, ids } = await walk(limit);
    expect(ids).toEqual(expected); expect(sizes.every((size) => size <= limit)).toBe(true); expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(11);
  });
  it('RSV-15 / I: el cursor no depende de lo que se cree después (una reserva nueva más reciente no desplaza la segunda página)', async () => {
    const first = await list({ page: { limit: 3 } }); const id = randomUUID(); const now = new Date(Date.UTC(2026, 10, 12, 23));
    await store.create({ id, ownerId: 'owner-A', pnr: 'ZNEW01', status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `pay_ok_${id}`, idempotencyKey: randomUUID(), passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '10.00' }, changes: [{ changedAt: now.toISOString(), description: 'CONFIRMED' }], attempts: 0 }); store.createdAt.set(id, now);
    const second = await list({ page: { limit: 3, cursor: first.nextCursor } }); expect(second.items.map((item) => item.bookingId)).toEqual(expected.slice(3, 6)); expect(second.items.map((item) => item.bookingId)).not.toContain(id);
    store.values.delete(id); store.createdAt.delete(id);
  });
  it('RSV-15 / audit-25: un cursor mal formado o alterado se rechaza (VALIDATION_FAILED), nunca se acepta ni se rompe; el válido hace ida y vuelta', async () => {
    const good = encodeListCursor(new Date(Date.UTC(2026, 10, 12, 6)), randomUUID()); expect(decodeListCursor(good).createdAt.toISOString()).toBe('2026-11-12T06:00:00.000Z');
    const text = Buffer.from(good, 'base64url').toString('utf8');
    const tampered = ['no-es-un-cursor', `${good}!!`, `${good}AA`, good.slice(1), 'A'.repeat(201), '', Buffer.from(text.replace('|', '#')).toString('base64url'), Buffer.from('2026-02-31T10:00:00.000Z|abc').toString('base64url'), Buffer.from('2026-11-12').toString('base64url'), Buffer.from("x' OR 1=1 --").toString('base64url')];
    for (const cursor of tampered) expect({ cursor: cursor.slice(0, 20), error: (() => { try { decodeListCursor(cursor); return 'aceptado'; } catch (error) { return (error as { code?: string; message?: string }).code ?? (error as Error).message; } })() }).toEqual({ cursor: cursor.slice(0, 20), error: expect.stringContaining('VALIDATION_FAILED') });
  });
});
