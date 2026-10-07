import { afterAll, beforeAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { capacity, cleanup, createFlight, Harness, holdRequest, ownerId, startHarness } from '../helpers';

describe('INV-12 concurrencia', () => {
  let h: Harness = undefined as never;
  beforeAll(async () => { h = await startHarness(); await cleanup(h.prisma); });
  afterAll(async () => {
    if (!h) return;
    try { await cleanup(h.prisma); } finally { await h.close(); }
  });

  it('20 CreateHold simult?neos por los ?ltimos 3 asientos ? exactamente 3 holds', async () => {
    const flight = await createFlight(h, 3);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => h.call('CreateHold', holdRequest(ownerId(), flight, 1)))
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(rejected).toHaveLength(17);
    expect(rejected.every((r) => (r.reason as { details?: string }).details === 'OFFER_NO_LONGER_AVAILABLE')).toBe(true);
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 3, sold: 0 });
  });

  it('doble ConsumeHold concurrente de reservas distintas ? exactamente uno consume', async () => {
    const flight = await createFlight(h, 3);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 2));
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => h.call('ConsumeHold', { holdId: hold.holdId, ownerId: owner, reservationId: randomUUID() }))
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0, sold: 2 });
    expect(await h.prisma.reservedInventory.count({ where: { holdId: hold.holdId } })).toBe(1);
  });

  it('doble ConsumeHold concurrente de la misma reserva ? idempotente: se consume una sola vez', async () => {
    const flight = await createFlight(h, 3);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 2));
    const reservationId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => h.call<{ status: string }>('ConsumeHold', { holdId: hold.holdId, ownerId: owner, reservationId }))
    );
    expect(results.every((r) => r.status === 'CONSUMED')).toBe(true);
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0, sold: 2 });
    expect(await h.prisma.reservedInventory.count({ where: { holdId: hold.holdId } })).toBe(1);
  });

  it('CreateHold concurrente con la misma (owner, key) ? un solo hold', async () => {
    const flight = await createFlight(h, 5);
    const req = holdRequest(ownerId(), flight, 2, 'same-key');
    const results = await Promise.all(Array.from({ length: 6 }, () => h.call<{ holdId: string }>('CreateHold', req)));
    expect(new Set(results.map((r) => r.holdId)).size).toBe(1);
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 2 });
  });
});
