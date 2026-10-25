import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { ReservationQueries } from '../../src/application/queries';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaReservationStore } from '../../src/infrastructure/persistence/prisma-reservation-store';
import { createReservationServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const key = 'f'.repeat(40);
type Item = { bookingId: string; ownerId: string; pnr: string };
type Page = { items: Item[]; nextCursor?: string };
type Client = { listReservationsByFlightInstance(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: Page) => void): void; close(): void };
const pnr = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[randomInt(0, 24)]).join('');

describe('RSV-FLT: ListReservationsByFlightInstance con Prisma y gRPC reales', () => {
  let prisma: PrismaClient; let app: INestMicroservice; let client: Client;
  const flightId = randomUUID(); const otherFlightId = randomUUID(); const created: string[] = [];
  const owners = [`owner-${randomUUID()}`, `owner-${randomUUID()}`, `owner-${randomUUID()}`];
  const expected = new Map<string, string>();
  const metadata = (role: string, ownerId = owners[0]) => { const value = new Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', ownerId); value.set('x-role', role); return value; };
  const call = (request: unknown, role = 'system', ownerId?: string) => new Promise<Page>((resolve, reject) => client.listReservationsByFlightInstance(request, metadata(role, ownerId), (error, response) => error ? reject(error) : resolve(response)));
  const insert = async (store: PrismaReservationStore, ownerId: string, flight: string) => {
    const id = randomUUID(); created.push(id);
    await store.create({ id, ownerId, pnr: pnr(), status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `pay_ok_${id}`, idempotencyKey: `flt-${id}`, passengers: [], itineraries: [{ itineraryId: randomUUID(), segments: [{ flightInstanceId: flight }] }], grandTotal: { currency: 'USD', total: '1.00' }, changes: [{ changedAt: new Date().toISOString(), description: 'CREATED' }], attempts: 0 });
    return id;
  };

  beforeAll(async () => {
    const env = join(process.cwd(), 'microservices', 'reservation-service', '.env'); if (!process.env.DATABASE_URL && existsSync(env)) process.loadEnvFile(env);
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Reservation by-flight integration tests');
    prisma = new PrismaClient(); await prisma.$connect(); const store = new PrismaReservationStore(prisma);
    for (let index = 0; index < 5; index += 1) { const ownerId = owners[index % owners.length]; expected.set(await insert(store, ownerId, flightId), ownerId); }
    await insert(store, owners[0], otherFlightId);
    const queries = new ReservationQueries(store); const port = 39000 + Math.floor(Math.random() * 900);
    app = await createReservationServer({ url: `127.0.0.1:${port}`, internalApiKey: key, deps: { listReservationsByFlightInstance: (input) => queries.byFlightInstance(input as { flightInstanceId: string; limit?: number; cursor?: string }) } }); await app.listen();
    const root = findProtoRoot(); const definition = loadSync(join(root, 'flightplatform/reservation/v1/reservation.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.reservation.v1.ReservationService(`127.0.0.1:${port}`, credentials.createInsecure());
  }, 60_000);
  afterAll(async () => { try { await prisma?.reservation.deleteMany({ where: { id: { in: created } } }); } finally { client?.close(); await app?.close(); await prisma?.$disconnect(); } });

  it('RSV-FLT-01: recorre todas las páginas de un vuelo con ownerId, sin repetir ni omitir', async () => {
    const seen: Item[] = []; let cursor: string | undefined; let pages = 0;
    do { const page = await call({ flightInstanceId: flightId, limit: 2, ...(cursor ? { cursor } : {}) }); pages += 1; seen.push(...page.items); cursor = page.nextCursor || undefined; } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen.map((item) => item.bookingId).sort()).toEqual([...expected.keys()].sort());
    for (const item of seen) expect(item.ownerId).toBe(expected.get(item.bookingId));
  });

  it('RSV-FLT-02: sin cursor ni limit devuelve la primera página completa y no incluye otros vuelos', async () => {
    const page = await call({ flightInstanceId: flightId });
    expect(page.items).toHaveLength(5); expect(page.nextCursor || undefined).toBeUndefined();
    expect(await call({ flightInstanceId: randomUUID() })).toMatchObject({ items: [] });
  });

  it('RSV-FLT-03: límite fuera de 1..50 y cursor inválido ⇒ INVALID_ARGUMENT', async () => {
    await expect(call({ flightInstanceId: flightId, limit: 51 })).rejects.toMatchObject({ code: 3 });
    await expect(call({ flightInstanceId: flightId, cursor: 'no-es-uuid' })).rejects.toMatchObject({ code: 3 });
  });

  it.each(['customer', 'partner', 'admin'])('RSV-FLT-04 / S: el rol %s no puede listar reservas de un vuelo (PERMISSION_DENIED)', async (role) => {
    await expect(call({ flightInstanceId: flightId }, role, owners[0])).rejects.toMatchObject({ code: 7 });
  });
});
