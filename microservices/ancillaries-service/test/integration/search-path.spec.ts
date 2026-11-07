import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { pinPublicSearchPath, serviceDatabaseUrl, singleConnectionUrl } from '../../../../test-support/search-path';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaBookingOwnershipStore } from '../../src/infrastructure/persistence/prisma-booking-ownership';
import { PrismaBaggageStore } from '../../src/infrastructure/persistence/prisma-baggage';
import { table } from '../../src/infrastructure/persistence/schema';

// Incidente F12b-1: getAssignments fallaba con 42P01 `relation "booking_owners" does not exist` cuando el search_path no era el del esquema.
describe('ADR-F12b1-fix-01: consultas a mano de Ancillaries con search_path = public', () => {
  let prisma: PrismaClient;
  const ownerId = `sp-owner-${randomUUID().slice(0, 8)}`;
  const bookingId = randomUUID();
  const itineraryId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: singleConnectionUrl(serviceDatabaseUrl('microservices/ancillaries-service')) });
    await prisma.$connect();
    await pinPublicSearchPath(prisma, 'ancillaries', 'booking_owners');
  }, 60_000);
  afterAll(async () => {
    try { if (prisma) { await prisma.baggageItem.deleteMany({ where: { bookingId } }); await prisma.$executeRaw`DELETE FROM ${table('booking_owners')} WHERE "booking_id" = ${bookingId}::uuid`; } } finally { await prisma?.$disconnect(); }
  });

  it('claimOrAssertOwner y assertOwner (booking_owners) resuelven la tabla con el esquema explícito', async () => {
    const store = new PrismaBookingOwnershipStore(prisma);
    await expect(store.claimOrAssertOwner(bookingId, ownerId)).resolves.toBeUndefined();
    await expect(store.assertOwner(bookingId, ownerId)).resolves.toBeUndefined();
    await expect(store.assertOwner(bookingId, 'otro-dueno')).rejects.toBeDefined();
  });

  it('reserve y purchase de equipaje (pg_advisory_xact_lock) funcionan sin depender del search_path', async () => {
    const store = new PrismaBaggageStore(prisma);
    const item = { bookingId, ownerId, passengerId: null, itineraryId, quantity: 1, status: 'PROVISIONAL' as const };
    await expect(store.reserve([item], 3)).resolves.toBeUndefined();
    await expect(store.purchase({ ...item, passengerId: randomUUID() }, 3)).resolves.toBeGreaterThanOrEqual(1);
  });
});
