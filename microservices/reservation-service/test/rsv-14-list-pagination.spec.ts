import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InMemoryReservationStore, StoredReservation } from '../src/application/reservation-store';
import { composeReservation } from '../src/infrastructure/grpc/reservation-composition';
import { createReservationServer, findProtoRoot } from '../src/infrastructure/grpc/server';

/**
 * RSV-14 (F12c-1, punto 0): ListReservations con paginación por gRPC REAL y la composición REAL (controlador → composeReservation → ReservationQueries → almacén).
 * Las pruebas anteriores sustituían `listReservations` por un doble o consultaban con una sola reserva y un limit mayor: el `page { limit, cursor }` del .proto
 * llegaba al caso de uso como objeto anidado, que lo ignoraba (limit siempre 20, cursor sin efecto) y nadie lo notaba.
 */
const key = 's'.repeat(40);
type Page = { items: Array<{ bookingId: string; pnr: string }>; nextCursor?: string };
type Client = { listReservations(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: Page) => void): void; close(): void };
const stub = new Proxy({}, { get: () => () => { throw new Error('not used'); } }) as never;

describe('RSV-14: ListReservations pagina de verdad (page.limit y page.cursor del .proto)', () => {
  let app: INestMicroservice; let client: Client; const store = new InMemoryReservationStore(); const mine: string[] = []; const theirs: string[] = [];
  const metadata = (owner: string) => { const value = new Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', owner); value.set('x-role', 'customer'); return value; };
  const list = (owner: string, request: object) => new Promise<Page>((resolve, reject) => client.listReservations(request, metadata(owner), (error, response) => error ? reject(error) : resolve(response)));
  const seed = async (owner: string, index: number, target: string[]) => { const id = randomUUID(); target.push(id); const value: StoredReservation = { id, ownerId: owner, pnr: `P${String(index).padStart(5, '0')}`, status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `pay_ok_${id}`, idempotencyKey: randomUUID(), passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '10.00' }, changes: [{ changedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(), description: 'CONFIRMED' }], attempts: 0 }; await store.create(value); };

  beforeAll(async () => {
    for (let index = 0; index < 23; index += 1) await seed('owner-A', index, mine); // más que el valor por omisión (20) de ReservationQueries
    for (let index = 0; index < 3; index += 1) await seed('owner-B', 100 + index, theirs);
    const deps = composeReservation({ store, pricing: stub, payment: stub, ancillaries: stub, inventory: stub, ticketing: stub, events: stub, operations: stub, quotes: stub, clock: { now: () => new Date() } as never, cutoffHours: 4, holdTtlMinutes: 20, validateResponse: () => undefined });
    const port = 39000 + Math.floor(Math.random() * 900);
    app = await createReservationServer({ url: `127.0.0.1:${port}`, internalApiKey: key, deps }); await app.listen();
    const definition = loadSync(`${findProtoRoot()}/flightplatform/reservation/v1/reservation.proto`, { includeDirs: [findProtoRoot()], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.reservation.v1.ReservationService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => { try { client?.close(); } finally { await app?.close(); } });

  it('RSV-14 / I: page.limit se respeta (5 de 23), con nextCursor', async () => {
    const first = await list('owner-A', { page: { limit: 5 } });
    expect(first.items).toHaveLength(5); expect(first.nextCursor).toBeTruthy();
  });
  it('RSV-14 / I: recorrer con page.cursor devuelve las 23 una sola vez, sin repetir ni saltar, y cierra sin nextCursor', async () => {
    const seen: string[] = []; const sizes: number[] = []; let cursor: string | undefined;
    for (let pages = 0; pages < 20; pages += 1) {
      const response = await list('owner-A', { page: { limit: 5, ...(cursor ? { cursor } : {}) } });
      sizes.push(response.items.length); seen.push(...response.items.map((item) => item.bookingId)); cursor = response.nextCursor || undefined; if (!cursor) break;
    }
    expect(sizes).toEqual([5, 5, 5, 5, 3]); expect(new Set(seen).size).toBe(23); expect([...seen].sort()).toEqual([...mine].sort());
  });
  it('RSV-14 / I: la segunda página NO repite la primera ni su cursor (el síntoma de producción)', async () => {
    const first = await list('owner-A', { page: { limit: 5 } }); const second = await list('owner-A', { page: { limit: 5, cursor: first.nextCursor } });
    expect(second.items.map((item) => item.bookingId)).not.toEqual(first.items.map((item) => item.bookingId)); expect(second.nextCursor).not.toBe(first.nextCursor);
  });
  it('RSV-14 / I: page es opcional — sin page (o con page vacío) se usan los valores por omisión: primera página de 20 con nextCursor', async () => {
    for (const request of [{}, { page: {} }]) { const response = await list('owner-A', request); expect(response.items).toHaveLength(20); expect(response.nextCursor).toBeTruthy(); }
  });
  it('RSV-14 / S: un cursor inválido es INVALID_ARGUMENT (no se interpreta ni se ignora)', async () => {
    await expect(list('owner-A', { page: { limit: 5, cursor: 'no-es-un-cursor' } })).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });
  it('RSV-14 / I: con limit 50 caben las 23 y no hay nextCursor (y el valor 20 del caso de uso ya no manda)', async () => {
    const all = await list('owner-A', { page: { limit: 50 } }); expect(all.items).toHaveLength(23); expect(all.nextCursor || undefined).toBeUndefined();
    expect((await list('owner-A', { page: { limit: 1 } })).items).toHaveLength(1);
  });
  it('RSV-14 / S: la paginación sigue filtrada por dueño y con los filtros (pnr)', async () => {
    const other = await list('owner-B', { page: { limit: 2 } }); expect(other.items).toHaveLength(2); expect(other.items.every((item) => theirs.includes(item.bookingId))).toBe(true);
    const byPnr = await list('owner-A', { pnr: 'P00003', page: { limit: 5 } }); expect(byPnr.items).toHaveLength(1);
  });
});
