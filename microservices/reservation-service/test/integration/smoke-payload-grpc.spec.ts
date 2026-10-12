import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
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
type Client = { createReservation(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close(): void };

describe('RSV-13: payload del smoke por gRPC real', () => {
  let app: INestMicroservice; let client: Client; let received: unknown;
  const metadata = () => { const value = new Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', 'smoke-owner'); value.set('x-role', 'system'); return value; };
  const create = () => new Promise<unknown>((resolve, reject) => client.createReservation(smokePayload, metadata(), (error, response) => error ? reject(error) : resolve(response)));

  beforeAll(async () => {
    const port = 38000 + Math.floor(Math.random() * 1000);
    app = await createReservationServer({ url: `127.0.0.1:${port}`, internalApiKey: key, deps: { createReservation: async (input) => { received = input; return { bookingId: '00000000-0000-4000-8000-000000000005', status: 'CONFIRMED', passengers: input.passengers, tickets: [] }; } } });
    await app.listen();
    const definition = loadSync(`${findProtoRoot()}/flightplatform/reservation/v1/reservation.proto`, { includeDirs: [findProtoRoot()], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.reservation.v1.ReservationService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => { try { client?.close(); } finally { await app?.close(); } });

  it('RSV-13 / I: CreateReservation acepta exactamente el payload del smoke', async () => {
    await expect(create()).resolves.toMatchObject({ bookingId: '00000000-0000-4000-8000-000000000005', status: 'CONFIRMED' });
    expect(received).toMatchObject({ ownerId: 'smoke-owner', ...smokePayload });
  });
});
