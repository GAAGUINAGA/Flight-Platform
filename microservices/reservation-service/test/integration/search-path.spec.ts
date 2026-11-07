import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { pinPublicSearchPath, serviceDatabaseUrl, singleConnectionUrl } from '../../../../test-support/search-path';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaBaggageOperations } from '../../src/infrastructure/persistence/prisma-baggage-operations';
import { PrismaReservationStore } from '../../src/infrastructure/persistence/prisma-reservation-store';
import { BaggageResult } from '../../src/application/baggage-operations';

// Incidente F12b-1: las consultas a mano de equipaje usaban "baggage_purchases" y "reservations" sin esquema.
describe('ADR-F12b1-fix-01: consultas a mano de Reservation con search_path = public', () => {
  let prisma: PrismaClient;
  const bookingId = randomUUID();
  const ownerId = `sp-owner-${randomUUID().slice(0, 8)}`;
  const paymentReference = `pay_sp_${bookingId}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: singleConnectionUrl(serviceDatabaseUrl('microservices/reservation-service')) });
    await prisma.$connect();
    await new PrismaReservationStore(prisma).create({ id: bookingId, ownerId, pnr: 'SPA123', status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `pay_ok_${bookingId}`, idempotencyKey: `sp-${bookingId}`, passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '1.00' }, changes: [{ changedAt: new Date().toISOString(), description: 'CREATED' }], attempts: 0 });
    await pinPublicSearchPath(prisma, 'reservation', 'reservations');
  }, 60_000);
  afterAll(async () => {
    try { if (prisma) { await prisma.baggagePurchase.deleteMany({ where: { bookingId } }); await prisma.paymentUsage.deleteMany({ where: { paymentReference } }); await prisma.reservation.deleteMany({ where: { id: bookingId } }); } } finally { await prisma?.$disconnect(); }
  });

  it('complete (FOR UPDATE sobre baggage_purchases y reservations) resuelve las tablas con el esquema explícito', async () => {
    const operations = new PrismaBaggageOperations(prisma);
    const operation = await operations.claim({ id: randomUUID(), bookingId, ownerId, idempotencyKey: `sp-key-${bookingId}`, requestHash: 'h'.repeat(8), paymentReference, amountMinor: 250, status: 'PENDING', response: undefined });
    const expected: BaggageResult = { passengerId: randomUUID(), itineraryId: randomUUID(), totalBaggage: 1 };
    const result = await operations.complete(operation, new Date(), async () => expected);
    expect(result).toEqual(expected);
    const total = (await prisma.reservation.findUniqueOrThrow({ where: { id: bookingId } })).grandTotal as { total: string };
    expect(total.total).toBe('3.50');
  });
});
