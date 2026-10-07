import { afterAll, beforeAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ADMIN, capacity, cleanup, createFlight, Harness, holdRequest, ownerId, shortHold, sleepPastExpiry, startHarness, SYSTEM } from '../helpers';

const DAY = 24 * 60;

describe('INV-07..11 holds', () => {
  let h: Harness = undefined as never;
  beforeAll(async () => { h = await startHarness(); await cleanup(h.prisma); });
  afterAll(async () => {
    if (!h) return;
    try { await cleanup(h.prisma); } finally { await h.close(); }
  });

  it('INV-07: CreateHold descuenta capacidad y la repetici?n con la misma key devuelve el mismo hold', async () => {
    const flight = await createFlight(h, 5);
    const req = holdRequest(ownerId(), flight, 2, 'key-1');
    const first = await h.call<{ holdId: string; status: string }>('CreateHold', req);
    expect(first.status).toBe('HELD');
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 2, sold: 0 });
    const again = await h.call<{ holdId: string }>('CreateHold', req);
    expect(again.holdId).toBe(first.holdId);
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 2 });
  });

  it('INV-07: sin capacidad suficiente ? OFFER_NO_LONGER_AVAILABLE y no se descuenta nada', async () => {
    const flight = await createFlight(h, 2);
    await expect(h.call('CreateHold', holdRequest(ownerId(), flight, 3)))
      .rejects.toMatchObject({ code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0 });
  });

  it('INV-07: rechaza instancias cerradas y vuelos que ya salieron', async () => {
    const flight = await createFlight(h, 5);
    await h.call('CloseFlightInstance', { flightInstanceId: flight }, ADMIN);
    await expect(h.call('CreateHold', holdRequest(ownerId(), flight, 1))).rejects.toMatchObject({ details: 'OFFER_NO_LONGER_AVAILABLE' });
    const other = await createFlight(h, 5);
    h.clock.advanceMinutes(31 * DAY);
    await expect(h.call('CreateHold', holdRequest(ownerId(), other, 1))).rejects.toMatchObject({ details: 'OFFER_NO_LONGER_AVAILABLE' });
    h.clock.advanceMinutes(-31 * DAY);
  });

  it('INV-07: un hold vencido libera su capacidad perezosamente al crear otro', async () => {
    const flight = await createFlight(h, 2);
    await h.call('CreateHold', shortHold(ownerId(), flight, 2));
    await expect(h.call('CreateHold', holdRequest(ownerId(), flight, 1))).rejects.toMatchObject({ details: 'OFFER_NO_LONGER_AVAILABLE' });
    await sleepPastExpiry();
    const second = await h.call<{ status: string }>('CreateHold', holdRequest(ownerId(), flight, 2));
    expect(second.status).toBe('HELD');
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 2 });
  });

  it('INV-08: liberar restituye capacidad; repetir o liberar un vencido es idempotente', async () => {
    const flight = await createFlight(h, 4);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 3));
    const ref = { holdId: hold.holdId, ownerId: owner };
    expect((await h.call<{ status: string }>('ReleaseHold', ref)).status).toBe('RELEASED');
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0 });
    expect((await h.call<{ status: string }>('ReleaseHold', ref)).status).toBe('RELEASED');
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0 });

    const second = await h.call<{ holdId: string }>('CreateHold', shortHold(owner, flight, 1));
    const ref2 = { holdId: second.holdId, ownerId: owner };
    await sleepPastExpiry();
    expect((await h.call<{ status: string }>('GetHold', ref2)).status).toBe('EXPIRED');
    expect((await h.call<{ status: string }>('ReleaseHold', ref2)).status).toBe('EXPIRED');
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0 });
  });

  it('INV-08: liberar un hold CONSUMED falla con OFFER_NO_LONGER_AVAILABLE (GAP-011)', async () => {
    const flight = await createFlight(h, 4);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 1));
    await h.call('ConsumeHold', { holdId: hold.holdId, ownerId: owner, reservationId: randomUUID() });
    await expect(h.call('ReleaseHold', { holdId: hold.holdId, ownerId: owner }))
      .rejects.toMatchObject({ code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
  });

  it('INV-09: ConsumeHold mueve held ? sold y registra reserved_inventory; un hold vencido no es consumible', async () => {
    const flight = await createFlight(h, 4);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 2));
    const reservationId = randomUUID();
    const consume = (id = reservationId) => h.call<{ status: string }>('ConsumeHold', { holdId: hold.holdId, ownerId: owner, reservationId: id });
    expect((await consume()).status).toBe('CONSUMED');
    expect((await consume()).status).toBe('CONSUMED'); // reintento de la misma reserva: idempotente
    await expect(consume(randomUUID())).rejects.toMatchObject({ details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0, sold: 2 });
    expect(await h.prisma.reservedInventory.count({ where: { holdId: hold.holdId, releasedAt: null } })).toBe(1);

    const stale = await h.call<{ holdId: string }>('CreateHold', shortHold(owner, flight, 1));
    await sleepPastExpiry();
    await expect(h.call('ConsumeHold', { holdId: stale.holdId, ownerId: owner, reservationId: randomUUID() })).rejects.toMatchObject({ details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0, sold: 2 });
  });

  it('INV-10: dos ReleaseReservedInventory restituyen la capacidad una sola vez', async () => {
    const flight = await createFlight(h, 4);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 3));
    const reservationId = randomUUID();
    await h.call('ConsumeHold', { holdId: hold.holdId, ownerId: owner, reservationId });
    const release = () => h.call('ReleaseReservedInventory', { bookingId: reservationId, ownerId: owner });
    await release();
    await release();
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0, sold: 0 });
    await h.call('ReleaseReservedInventory', { bookingId: randomUUID(), ownerId: owner });
  });

  it('INV-11: ExpireHolds (system) marca EXPIRED, restituye capacidad y publica hold.expired', async () => {
    const flight = await createFlight(h, 4);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', shortHold(owner, flight, 2));
    h.events.events.length = 0;
    await sleepPastExpiry();
    const res = await h.call<{ expiredCount: number }>('ExpireHolds', {}, SYSTEM);
    expect(res.expiredCount).toBeGreaterThanOrEqual(1);
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0 });
    expect((await h.prisma.hold.findUniqueOrThrow({ where: { id: hold.holdId } })).status).toBe('EXPIRED');
    expect(h.events.events).toContainEqual(
      expect.objectContaining({ eventType: 'hold.expired', holdId: hold.holdId, ownerId: owner, data: { status: 'EXPIRED' } })
    );
    await h.call('ExpireHolds', {}, SYSTEM);
    expect(h.events.events.filter((e) => e.holdId === hold.holdId)).toHaveLength(1);
  });
});
