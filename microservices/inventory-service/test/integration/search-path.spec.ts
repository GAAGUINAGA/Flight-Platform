import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { pinPublicSearchPath, serviceDatabaseUrl, singleConnectionUrl } from '../../../../test-support/search-path';
import { CabinCapacity } from '../../src/domain/cabin-capacity';
import { FlightInstance } from '../../src/domain/flight-instance';
import { InventoryHold } from '../../src/domain/inventory-hold';
import { PrismaUnitOfWork } from '../../src/infrastructure/persistence/prisma-inventory';

// ADR-F12b1-fix-01: cada consulta a mano de Inventory debe resolverse con search_path = public (incidente de Supabase).
describe('ADR-F12b1-fix-01: consultas a mano de Inventory con search_path = public', () => {
  let prisma: PrismaClient; let uow: PrismaUnitOfWork;
  const owner = `sp-owner-${randomUUID().slice(0, 8)}`;
  const flightId = randomUUID(); const closedFlightId = randomUUID(); const reservation = `sp-res-${randomUUID().slice(0, 8)}`;
  const departureAt = new Date(Date.now() + 5 * 86_400_000); const arrivalAt = new Date(departureAt.getTime() + 3_600_000);
  const flight = (id: string, number: string) => new FlightInstance({ id, flightNumber: number, departureIata: 'AAA', arrivalIata: 'BBB', departureAt, arrivalAt, closed: false, cabins: [new CabinCapacity('ECONOMY', 10, 0, 0)] });
  const hold = (over: Partial<ConstructorParameters<typeof InventoryHold>[0]> = {}) => new InventoryHold({ id: randomUUID(), ownerId: owner, status: 'HELD', expiresAt: new Date(Date.now() + 600_000), idempotencyKey: randomUUID(), reservationId: null, lines: [{ flightInstanceId: flightId, cabinClass: 'ECONOMY', seats: 2 }], ...over });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: singleConnectionUrl(serviceDatabaseUrl('microservices/inventory-service')) });
    await prisma.$connect();
    await pinPublicSearchPath(prisma, 'inventory', 'holds');
    uow = new PrismaUnitOfWork(prisma);
  }, 60_000);
  afterAll(async () => {
    try { if (prisma) { await prisma.reservedInventory.deleteMany({ where: { ownerId: owner } }); await prisma.hold.deleteMany({ where: { ownerId: owner } }); await prisma.flightInstance.deleteMany({ where: { id: { in: [flightId, closedFlightId] } } }); } } finally { await prisma?.$disconnect(); }
  });

  it('recorre cada consulta a mano de PrismaTx (cabinas, holds, bloqueos y reservado)', async () => {
    const f = flight(flightId, 'SP001'); const expired = hold({ expiresAt: new Date(Date.now() - 60_000) }); const live = hold(); const sold = hold({ status: 'CONSUMED', reservationId: reservation });
    await uow.run(async (tx) => {
      await tx.saveFlight(f); await tx.saveFlight(flight(closedFlightId, 'SP002'));
      expect(await tx.setClosed(closedFlightId)).toBe(true);
      expect(await tx.tryReserve(flightId, 'ECONOMY', 2)).toBe(true);
      expect(await tx.tryReserve(closedFlightId, 'ECONOMY', 1)).toBe(false);
      for (const h of [expired, live, sold]) await tx.insertHold(h);
      expect((await tx.findHold(live.id, owner))?.id).toBe(live.id);
      expect((await tx.lockDueHolds(new Date(), [flightId], 10)).map((h) => h.id)).toContain(expired.id);
      expect((await tx.lockDueHolds(new Date(), undefined, 10)).map((h) => h.id)).toContain(expired.id);
      expect(await tx.updateHoldStatus(sold, 'HELD')).toBe(false);
      expect(await tx.updateHoldStatus(sold, 'HELD', new Date())).toBe(false);
      await tx.adjust('release', flightId, 'ECONOMY', 1);
      await tx.adjust('consume', flightId, 'ECONOMY', 1);
      await tx.insertReserved(sold);
      const rows = await tx.lockReserved(reservation, owner);
      expect(rows).toHaveLength(1);
      await tx.adjust('releaseSold', flightId, 'ECONOMY', 1);
      await tx.markReservedReleased(rows.map((r) => r.id), new Date());
    });
  });
});
