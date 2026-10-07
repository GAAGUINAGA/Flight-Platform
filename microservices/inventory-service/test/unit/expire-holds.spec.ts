import { FixedClock } from '@flight-platform/shared';
import { HoldUseCases } from '../../src/application/hold-use-cases';
import { InventoryConfig, InventoryTx, PublicEvent, UnitOfWork } from '../../src/application/ports';
import { InventoryHold } from '../../src/domain/inventory-hold';

const t0 = new Date('2026-10-10T10:00:00Z');
const config: InventoryConfig = { holdTtlMinutes: 20, airlineCode: 'FP' };

function hold(id: string, expiresAt: Date, seats: number, flight = 'f1'): InventoryHold {
  return new InventoryHold({
    id, ownerId: `owner-${id}`, status: 'HELD', expiresAt, idempotencyKey: id,
    lines: [{ flightInstanceId: flight, cabinClass: 'ECONOMY', seats }]
  });
}

/** Tx en memoria: solo implementa lo que usa el barrido. */
function fakeUow(holds: InventoryHold[], released: { flight: string; seats: number }[]): UnitOfWork {
  const tx = {
    lockDueHolds: async (now: Date) => holds.filter((h) => h.isDue(now)),
    updateHoldStatus: async () => true,
    adjust: async (change: string, flight: string, _cabin: string, seats: number) => {
      if (change === 'release') released.push({ flight, seats });
    }
  } as unknown as InventoryTx;
  return { run: (fn) => fn(tx) };
}

describe('INV-11 ExpireHolds', () => {
  const ctx = { correlationId: 'c1', role: 'system' };

  it('con el reloj adelantado los holds vencidos pasan a EXPIRED, restituyen capacidad y publican hold.expired', async () => {
    const due1 = hold('a', new Date('2026-10-10T10:20:00Z'), 2);
    const due2 = hold('b', new Date('2026-10-10T10:20:00Z'), 3);
    const live = hold('c', new Date('2026-10-10T11:00:00Z'), 4);
    const released: { flight: string; seats: number }[] = [];
    const events: PublicEvent[] = [];
    const uc = new HoldUseCases(
      fakeUow([due1, due2, live], released),
      { publish: async (e) => { events.push(e); } },
      new FixedClock(new Date('2026-10-10T10:21:00Z')),
      config
    );
    expect(await uc.expireHolds(ctx, {})).toBe(2);
    expect([due1.status, due2.status, live.status]).toEqual(['EXPIRED', 'EXPIRED', 'HELD']);
    expect(released).toEqual([{ flight: 'f1', seats: 5 }]);
    expect(events.map((e) => [e.eventType, e.holdId, e.data])).toEqual([
      ['hold.expired', 'a', { status: 'EXPIRED' }],
      ['hold.expired', 'b', { status: 'EXPIRED' }]
    ]);
  });

  it('con el reloj original no expira nada', async () => {
    const released: { flight: string; seats: number }[] = [];
    const uc = new HoldUseCases(
      fakeUow([hold('a', new Date('2026-10-10T10:20:00Z'), 2)], released),
      { publish: async () => undefined }, new FixedClock(t0), config
    );
    expect(await uc.expireHolds(ctx, {})).toBe(0);
    expect(released).toEqual([]);
  });

  it('un fallo del publicador no revierte la expiraci?n', async () => {
    const h = hold('a', new Date('2026-10-10T10:20:00Z'), 1);
    const uc = new HoldUseCases(
      fakeUow([h], []), { publish: async () => { throw new Error('webhooks ca?do'); } },
      new FixedClock(new Date('2026-10-10T10:30:00Z')), config
    );
    expect(await uc.expireHolds(ctx, {})).toBe(1);
    expect(h.status).toBe('EXPIRED');
  });

  it('exige rol system', async () => {
    const uc = new HoldUseCases(fakeUow([], []), { publish: async () => undefined }, new FixedClock(t0), config);
    await expect(uc.expireHolds({ correlationId: 'c', role: 'admin' }, {})).rejects.toMatchObject({ error: { code: 7 } });
  });
});
