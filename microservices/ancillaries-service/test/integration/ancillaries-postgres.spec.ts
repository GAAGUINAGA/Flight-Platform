import { afterAll, beforeAll, expect, it } from '@jest/globals';
import process from 'node:process';
import { join } from 'node:path';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaSeatMapStore } from '../../src/infrastructure/persistence/prisma-seat-map';
import { PrismaSeatAssignmentStore } from '../../src/infrastructure/persistence/prisma-seat-assignments';
import { PrismaBaggageStore } from '../../src/infrastructure/persistence/prisma-baggage';
import { PrismaBookingOwnershipStore } from '../../src/infrastructure/persistence/prisma-booking-ownership';
import { SeatAssignments } from '../../src/application/seat-assignments';
import { Baggage } from '../../src/application/baggage';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { createAncillariesServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const ids = { flightId: '00000000-0000-4000-8000-000000000010', segmentId: '00000000-0000-4000-8000-000000000011', bookingId: '00000000-0000-4000-8000-000000000012', baggageBookingId: '00000000-0000-4000-8000-000000000013', itineraryId: '00000000-0000-4000-8000-000000000014', foreignBookingId: '00000000-0000-4000-8000-000000000015', passengerId: '00000000-0000-4000-8000-000000000016' };
const ownerId = 'ancillaries-integration-owner';
const internalKey = 'a'.repeat(40);
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void> & { close(): void };

describe('ANC-02/03/06/07/09: integración PostgreSQL', () => {
  let prisma: PrismaClient;
  let seats: SeatAssignments;
  let baggage: Baggage;
  let ownership: PrismaBookingOwnershipStore;
  let app: INestMicroservice;
  let client: Client;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Ancillaries integration tests');
    prisma = new PrismaClient();
    await prisma.$connect();
    const layouts = new PrismaSeatMapStore(prisma);
    const pricing = { resolveSegment: async () => ({ segmentId: ids.segmentId, flightInstanceId: ids.flightId, aircraft: 'E190' }), getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) };
    ownership = new PrismaBookingOwnershipStore(prisma);
    seats = new SeatAssignments(pricing, layouts, new PrismaSeatAssignmentStore(prisma), ownership);
    baggage = new Baggage(new PrismaBaggageStore(prisma), 3, ownership);
    const port = 38000 + Math.floor(Math.random() * 1000);
    app = await createAncillariesServer({ url: `127.0.0.1:${port}`, internalApiKey: internalKey, deps: { seats, baggage } });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(join(root, 'flightplatform/ancillaries/v1/ancillaries.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { ancillaries: { v1: { AncillariesService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.ancillaries.v1.AncillariesService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => {
    try { client?.close(); await app?.close(); }
    finally { try { if (prisma) { await prisma.seatAssignment.deleteMany({ where: { bookingId: { in: [ids.bookingId, ids.foreignBookingId] } } }); await prisma.baggageItem.deleteMany({ where: { bookingId: { in: [ids.baggageBookingId, ids.foreignBookingId] } } }); await prisma.$executeRaw`DELETE FROM "booking_owners" WHERE "booking_id" IN (${ids.bookingId}::uuid, ${ids.baggageBookingId}::uuid, ${ids.foreignBookingId}::uuid)`; } } finally { await prisma?.$disconnect(); } }
  });

  it('ANC-02/03 / I: existen tablas ancillaries y plantilla E190 sembrada', async () => {
    expect(await prisma.seatLayout.count({ where: { aircraft: 'E190' } })).toBeGreaterThan(0);
    expect(await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'ancillaries' AND indexname = 'seat_assignments_active_flight_seat_key'`).toHaveLength(1);
  });

  it('ANC-06/07 / I: la colisión se rechaza y check-in conserva una asignación existente', async () => {
    const input = { bookingId: ids.bookingId, ownerId, assignments: [{ passengerId: '00000000-0000-4000-8000-000000000021', segmentId: ids.segmentId, seatNumber: '1A', passengerType: 'ADULT' as const, cabinClass: 'BUSINESS' as const }] };
    await expect(seats.reserve(input)).resolves.toHaveLength(1);
    await expect(seats.reserve({ ...input, assignments: [{ ...input.assignments[0], passengerId: '00000000-0000-4000-8000-000000000022' }] })).rejects.toThrow(expect.objectContaining({ code: 'SEAT_TAKEN' }));
    await expect(seats.assignAtCheckIn({ bookingId: ids.bookingId, ownerId, passengerId: input.assignments[0].passengerId, segmentId: ids.segmentId, passengerType: 'ADULT', cabinClass: 'BUSINESS' })).resolves.toMatchObject({ seatNumber: '1A', status: 'CHECKED_IN' });
  });

  it('ANC-09 / C: diez reservas simultáneas del mismo asiento producen un solo éxito', async () => {
    await prisma.seatAssignment.deleteMany({ where: { bookingId: ids.bookingId } });
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => seats.reserve({ bookingId: ids.bookingId, ownerId, assignments: [{ passengerId: `00000000-0000-4000-8000-${String(30 + index).padStart(12, '0')}`, segmentId: ids.segmentId, seatNumber: '1A', passengerType: 'ADULT', cabinClass: 'BUSINESS' }] })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.seatAssignment.count({ where: { flightInstanceId: ids.flightId, seatNumber: '1A', status: { not: 'RELEASED' } } })).toBe(1);
  });

  it('ANC-08/09 / C: compras paralelas de equipaje nunca superan el máximo', async () => {
    await ownership.claimOrAssertOwner(ids.baggageBookingId, ownerId);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => baggage.purchase({ bookingId: ids.baggageBookingId, ownerId, passengerId: '00000000-0000-4000-8000-000000000040', itineraryId: ids.itineraryId, quantity: 1 })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(await prisma.baggageItem.aggregate({ where: { bookingId: ids.baggageBookingId, ownerId }, _sum: { quantity: true } })).toMatchObject({ _sum: { quantity: 3 } });
  });
  const foreignSnapshot = async () => ({ seats: await prisma.seatAssignment.count({ where: { bookingId: ids.foreignBookingId } }), baggage: await prisma.baggageItem.count({ where: { bookingId: ids.foreignBookingId } }) });
  const call = <T>(method: string, request: unknown, role?: string) => new Promise<T>((resolve, reject) => {
    const metadata = new Metadata();
    metadata.set('x-internal-key', internalKey);
    metadata.set('x-owner-id', 'owner-B');
    if (role) metadata.set('x-role', role);
    client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T));
  });
  const expectForeignOwnerDenied = async (operation: () => Promise<unknown>) => {
    await prisma.seatAssignment.deleteMany({ where: { bookingId: ids.foreignBookingId } });
    await prisma.baggageItem.deleteMany({ where: { bookingId: ids.foreignBookingId } });
    await prisma.$executeRaw`DELETE FROM "booking_owners" WHERE "booking_id" = ${ids.foreignBookingId}::uuid`;
    await baggage.reserve({ bookingId: ids.foreignBookingId, ownerId: 'owner-A', baggage: [{ itineraryId: ids.itineraryId, quantity: 1 }] });
    const before = await foreignSnapshot();
    await expect(operation()).rejects.toMatchObject({ code: 5, details: 'NOT_FOUND' });
    expect(await foreignSnapshot()).toEqual(before);
  };

  it('ANC-SEC-02 / S ReserveSeats: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe', async () => {
    await expectForeignOwnerDenied(() => call('reserveSeats', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner', assignments: [{ passengerId: ids.passengerId, segmentId: ids.segmentId, seatNumber: '1A', passengerType: 'ADULT', cabinClass: 'BUSINESS' }] }));
  });
  it('ANC-SEC-02 / S ConfirmSeats: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no modifica', async () => {
    await expectForeignOwnerDenied(() => call('confirmSeats', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner' }));
  });
  it('ANC-SEC-02 / S ReleaseSeats: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no modifica', async () => {
    await expectForeignOwnerDenied(() => call('releaseSeats', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner' }));
  });
  it('ANC-SEC-02 / S ReleaseAll: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no modifica', async () => {
    await expectForeignOwnerDenied(() => call('releaseAll', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner' }, 'admin'));
  });
  it('ANC-SEC-02 / S GetAssignments: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no lee', async () => {
    await expectForeignOwnerDenied(() => call('getAssignments', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner' }));
  });
  it('ANC-SEC-02 / S AssignSeatAtCheckIn: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe', async () => {
    await expectForeignOwnerDenied(() => call('assignSeatAtCheckIn', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner', passengerId: ids.passengerId, segmentId: ids.segmentId, passengerType: 'ADULT', cabinClass: 'BUSINESS' }));
  });
  it('ANC-SEC-02 / S ReserveBaggage: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe', async () => {
    await expectForeignOwnerDenied(() => call('reserveBaggage', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner', baggage: [{ itineraryId: ids.itineraryId, quantity: 1 }] }));
  });
  it('ANC-SEC-02 / S GetBaggageOptions: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no lee', async () => {
    await expectForeignOwnerDenied(() => call('getBaggageOptions', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner' }));
  });
  it('ANC-SEC-02 / S PurchaseBaggage: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe', async () => {
    await expectForeignOwnerDenied(() => call('purchaseBaggage', { bookingId: ids.foreignBookingId, ownerId: 'forged-owner', passengerId: ids.passengerId, itineraryId: ids.itineraryId, quantity: 1 }));
  });
});
