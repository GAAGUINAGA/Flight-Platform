import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';
import { createReservationServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const key = 's'.repeat(40);
const smokePayload = {
  holdId: '00000000-0000-4000-8000-000000000001',
  passengers: [{
    passengerId: '00000000-0000-4000-8000-000000000002', passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'SMOKE123', nationality: 'EC', documentExpiryDate: '2030-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'smoke@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [],
  }],
  payment: { paymentReference: 'pay_ok_00000000-0000-4000-8000-000000000003' },
  idempotencyKey: '00000000-0000-4000-8000-000000000004',
};
type Client = { createReservation(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; getReservation(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; listReservations(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close(): void };
const openapi = parse(readFileSync(join(process.cwd(), 'contracts/openapi/vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> } };

describe('RSV-13: payload del smoke por gRPC real', () => {
  let app: INestMicroservice; let client: Client; let received: unknown;
  const metadata = () => { const value = new Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', 'smoke-owner'); value.set('x-role', 'system'); return value; };
  const create = () => new Promise<unknown>((resolve, reject) => client.createReservation(smokePayload, metadata(), (error, response) => error ? reject(error) : resolve(response)));
  const call = (method: 'getReservation' | 'listReservations', request: unknown) => new Promise<unknown>((resolve, reject) => client[method](request, metadata(), (error, response) => error ? reject(error) : resolve(response)));

  beforeAll(async () => {
    const port = 38000 + Math.floor(Math.random() * 1000);
    const bookingId = '00000000-0000-4000-8000-000000000005';
    const reservation = (passengers: unknown[] = []) => ({ id: bookingId, pnr: 'SMOKE1', status: 'CONFIRMED', grandTotal: { currency: 'USD', total: '1.00' }, passengers, itineraries: [], tickets: [{ ticketId: 'ticket-1', bookingId, passengerId: smokePayload.passengers[0].passengerId, status: 'ISSUED', segments: [] }], changes: [{ changedAt: '2026-10-14T00:00:00.000Z', description: 'CONFIRMED' }] });
    app = await createReservationServer({ url: `127.0.0.1:${port}`, internalApiKey: key, deps: { createReservation: async (input) => { received = input; return reservation((input as { passengers: unknown[] }).passengers); }, getReservation: async (input) => { expect(input).toMatchObject({ bookingId, ownerId: 'smoke-owner' }); return reservation(); }, listReservations: async (input) => { expect(input).toMatchObject({ ownerId: 'smoke-owner' }); return { items: [reservation()], nextCursor: undefined }; } } });
    await app.listen();
    const definition = loadSync(`${findProtoRoot()}/flightplatform/reservation/v1/reservation.proto`, { includeDirs: [findProtoRoot()], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.reservation.v1.ReservationService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => { try { client?.close(); } finally { await app?.close(); } });

  it('RSV-13 / K: CreateReservation acepta el payload del smoke y devuelve BookingDetail conforme al contrato', async () => {
    const response = await create();
    expect(response).toMatchObject({ bookingId: '00000000-0000-4000-8000-000000000005', pnr: 'SMOKE1', status: 'CONFIRMED' });
    const validate = new Ajv({ strict: false, formats: { 'date-time': /^\d{4}-\d{2}-\d{2}T.+Z$/, uuid: /^[0-9a-f-]{36}$/i } }).compile({ ...openapi.components.schemas.BookingDetail, components: openapi.components });
    if (!validate(response)) throw new Error(JSON.stringify(validate.errors));
    expect(received).toMatchObject({ ownerId: 'smoke-owner', ...smokePayload });
  });

  it('RSV-13 / I: GetReservation y ListReservations preservan bookingId y PNR', async () => {
    const created = await create() as { bookingId: string; pnr: string };
    expect(created.bookingId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    await expect(call('getReservation', { bookingId: created.bookingId })).resolves.toMatchObject({ bookingId: created.bookingId, pnr: created.pnr, tickets: [expect.objectContaining({ bookingId: created.bookingId, status: 'ISSUED' })] });
    await expect(call('listReservations', { page: { limit: 10 } })).resolves.toMatchObject({ items: [expect.objectContaining({ bookingId: created.bookingId, pnr: created.pnr })] });
  });
});
