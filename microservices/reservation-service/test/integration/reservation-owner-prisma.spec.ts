import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
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

const key = 'r'.repeat(40); const owner = `owner-${randomUUID()}`; const other = `other-${randomUUID()}`; const bookingId = randomUUID();
type Client = Record<'getReservation' | 'getReservationSnapshot' | 'listReservations', (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void> & { close(): void };
describe('H5 / RSV-SEC-02/04: owner scope through gRPC and Prisma', () => {
  let prisma: PrismaClient; let app: INestMicroservice; let client: Client;
  const metadata = (ownerId: string) => { const value = new Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', ownerId); value.set('x-role', 'customer'); return value; };
  const call = (method: keyof Omit<Client, 'close'>, request: unknown, ownerId: string) => new Promise<unknown>((resolve, reject) => client[method](request, metadata(ownerId), (error, response) => error ? reject(error) : resolve(response)));
  beforeAll(async () => { const env = join(process.cwd(), 'microservices', 'reservation-service', '.env'); if (!process.env.DATABASE_URL && existsSync(env)) process.loadEnvFile(env); if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Reservation security integration tests'); prisma = new PrismaClient(); await prisma.$connect(); const store = new PrismaReservationStore(prisma); await store.create({ id: bookingId, ownerId: owner, pnr: 'OWN123', status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `pay_ok_${bookingId}`, idempotencyKey: `owner-${bookingId}`, passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '1.00' }, changes: [{ changedAt: new Date().toISOString(), description: 'CREATED' }], attempts: 0 }); const queries = new ReservationQueries(store); const port = 38000 + Math.floor(Math.random() * 1000); app = await createReservationServer({ url: `127.0.0.1:${port}`, internalApiKey: key, deps: { getReservation: (input) => queries.get(input as { bookingId: string; ownerId: string }), getReservationSnapshot: (input) => queries.get(input as { bookingId: string; ownerId: string }), listReservations: (input) => queries.list(input as { ownerId: string; limit?: number; cursor?: string; pnr?: string }) } }); await app.listen(); const root = findProtoRoot(); const definition = loadSync(join(root, 'flightplatform/reservation/v1/reservation.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true }); const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => Client } } } }; client = new pkg.flightplatform.reservation.v1.ReservationService(`127.0.0.1:${port}`, credentials.createInsecure()); });
  afterAll(async () => { try { await prisma?.reservation.deleteMany({ where: { id: bookingId } }); } finally { client?.close(); await app?.close(); await prisma?.$disconnect(); } });
  it('RSV-SEC-02 / S H5: GetReservation of another owner is NOT_FOUND over real gRPC', async () => { await expect(call('getReservation', { bookingId }, other)).rejects.toMatchObject({ code: 5, details: 'NOT_FOUND' }); });
  it('RSV-SEC-04 / S H5: GetReservationSnapshot of another owner is NOT_FOUND over real gRPC', async () => { await expect(call('getReservationSnapshot', { bookingId }, other)).rejects.toMatchObject({ code: 5, details: 'NOT_FOUND' }); });
  it('RSV-SEC-02 / S H5: ListReservations of another owner is empty over real gRPC', async () => { await expect(call('listReservations', { page: { limit: 50 } }, other)).resolves.toMatchObject({ items: [] }); });
});
