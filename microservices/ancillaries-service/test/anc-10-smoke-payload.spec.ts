import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { SeatAssignments, Assignment, AssignmentStore } from '../src/application/seat-assignments';
import { createAncillariesServer, findProtoRoot } from '../src/infrastructure/grpc/server';
import { BookingOwnershipStore, ownershipNotFound } from '../src/application/booking-ownership';

const key = 'a'.repeat(40);
const ids = { bookingId: '00000000-0000-4000-8000-000000000001', passengerId: '00000000-0000-4000-8000-000000000002', segmentId: '00000000-0000-4000-8000-000000000003', flightId: '00000000-0000-4000-8000-000000000004' };
type Client = { reserveSeats(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: { assignments: Assignment[] }) => void): void; close(): void };

class MemoryAssignments implements AssignmentStore {
  values: Assignment[] = [];
  async create(value: Assignment) { this.values.push(value); return value; }
  async find() { return null; }
  async list() { return this.values; }
  async updateStatus() { return this.values; }
  async activeSeatNumbers() { return []; }
}

describe('ANC-10: payload del smoke', () => {
  let app: INestMicroservice;
  let client: Client;
  const store = new MemoryAssignments();
  const call = (request: unknown) => new Promise<{ assignments: Assignment[] }>((resolve, reject) => {
    const metadata = new Metadata();
    metadata.set('x-internal-key', key); metadata.set('x-owner-id', 'smoke-owner');
    client.reserveSeats(request, metadata, (error, response) => error ? reject(error) : resolve(response));
  });
  beforeAll(async () => {
    const port = 37000 + Math.floor(Math.random() * 1000);
    const pricing = { resolveSegment: async () => ({ segmentId: ids.segmentId, flightInstanceId: ids.flightId, aircraft: 'E190' }), getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) };
    const layouts = { listByAircraft: async () => [{ cabinClass: 'ECONOMY', seatNumber: '1A', rowNumber: 1, characteristics: [] }] };
    const owners = new Map<string, string>();
    const ownership: BookingOwnershipStore = { claimOrAssertOwner: async (bookingId, ownerId) => { const saved = owners.get(bookingId); if (saved && saved !== ownerId) ownershipNotFound(); owners.set(bookingId, ownerId); }, assertOwner: async (bookingId, ownerId) => { if (owners.get(bookingId) !== ownerId) ownershipNotFound(); } };
    app = await createAncillariesServer({ url: `127.0.0.1:${port}`, internalApiKey: key, deps: { seats: new SeatAssignments(pricing, layouts, store, ownership) } });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(`${root}/flightplatform/ancillaries/v1/ancillaries.proto`, { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { ancillaries: { v1: { AncillariesService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.ancillaries.v1.AncillariesService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => { try { client?.close(); } finally { await app?.close(); } });

  it('ANC-10 / I: ReserveSeats acepta exactamente el payload que envía smoke.cjs', async () => {
    await expect(call({ bookingId: ids.bookingId, assignments: [{ passengerId: ids.passengerId, segmentId: ids.segmentId, seatNumber: '1A', passengerType: 'ADULT', cabinClass: 'ECONOMY' }] })).resolves.toMatchObject({ assignments: [{ bookingId: ids.bookingId, passengerId: ids.passengerId, status: 'PROVISIONAL' }] });
  });
});
