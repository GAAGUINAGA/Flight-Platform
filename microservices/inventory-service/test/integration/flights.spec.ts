import { afterAll, beforeAll } from '@jest/globals';
import { seed } from '../../prisma/seed';
import { ADMIN, cleanup, createFlight, Harness, startHarness } from '../helpers';

type Cabins = { cabinClass: string; capacity: number }[];

describe('INV-02/03/05/06 vuelos: migraci?n, seed, consultas y administraci?n', () => {
  let h: Harness = undefined as never;
  beforeAll(async () => { h = await startHarness(); await cleanup(h.prisma); });
  afterAll(async () => {
    if (!h) return;
    try { await cleanup(h.prisma); } finally { await h.close(); }
  });

  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const mix = (adults: number, infants = 0) => ({ adults, youths: 0, children: 0, infants });
  const cabinKey = (flightInstanceId: string, cabinClass = 'ECONOMY') => ({ flightInstanceId_cabinClass: { flightInstanceId, cabinClass } });

  it('INV-02: la migraci?n cre? las cinco tablas del esquema inventory', async () => {
    const rows = await h.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name <> '_prisma_migrations'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      ['cabin_inventory', 'flight_instances', 'hold_lines', 'holds', 'reserved_inventory']
    );
  });

  it('INV-02: el CHECK impide held + sold > sellable', async () => {
    const id = await createFlight(h, 2);
    await expect(
      h.prisma.$executeRaw`UPDATE "inventory"."cabin_inventory" SET held = 3 WHERE flight_instance_id = ${id}::uuid`
    ).rejects.toThrow();
  });

  it('INV-03: el seed crea 60 d?as de rutas consultables y es idempotente', async () => {
    const created = await seed(h.prisma);
    expect(created).toBeGreaterThan(14 * 55);
    const res = await h.call<{ flights: { segment: { departure: { iataCode: string }; arrival: { iataCode: string } }; cabinClass: string; availableSeats: number }[] }>(
      'QueryAvailability', { origin: 'UIO', destination: 'GYE', departureDate: tomorrow(), passengers: mix(2, 1) }
    );
    expect(res.flights.length).toBeGreaterThanOrEqual(4); // 2 salidas ? (ECONOMY, BUSINESS)
    expect(res.flights.every((f) => f.segment.departure.iataCode === 'UIO' && f.segment.arrival.iataCode === 'GYE')).toBe(true);
    expect(res.flights.find((f) => f.cabinClass === 'ECONOMY')?.availableSeats).toBe(96);
    const seeded = () => h.prisma.flightInstance.count({ where: { flightNumber: { startsWith: 'FP' } } });
    const before = await seeded();
    await seed(h.prisma);
    expect(await seeded()).toBe(before);
  });

  it('INV-05: filtra por cabina, exige asientos suficientes y rechaza mezclas inv?lidas', async () => {
    await seed(h.prisma);
    const base = { origin: 'UIO', destination: 'GYE', departureDate: tomorrow() };
    const biz = await h.call<{ flights: { cabinClass: string; availableSeats: number }[] }>('QueryAvailability', {
      ...base, passengers: mix(1), cabinClass: 'BUSINESS'
    });
    expect(biz.flights.length).toBeGreaterThan(0);
    expect(biz.flights.every((f) => f.cabinClass === 'BUSINESS' && f.availableSeats === 8)).toBe(true);
    const none = await h.call<{ flights: unknown[] }>('QueryAvailability', { ...base, passengers: mix(9), cabinClass: 'BUSINESS' });
    expect(none.flights).toHaveLength(0);
    await expect(h.call('QueryAvailability', { ...base, passengers: mix(1, 2) })).rejects.toMatchObject({ code: 3 });
  });

  it('INV-05: Get/Find/List devuelven la instancia con su capacidad', async () => {
    const id = await createFlight(h, 7, [{ cabin: 'BUSINESS', capacity: 3 }]);
    const got = await h.call<{ flightInstanceId: string; cabins: Cabins; segment: { flightNumber: string; departure: { at: string } } }>(
      'GetFlightInstance', { flightInstanceId: id }
    );
    expect(got.cabins).toEqual([{ cabinClass: 'ECONOMY', capacity: 7 }, { cabinClass: 'BUSINESS', capacity: 3 }]);
    const found = await h.call<{ flightInstanceId: string }>('FindFlightInstance', {
      flightNumber: got.segment.flightNumber, departureDate: got.segment.departure.at.slice(0, 10)
    });
    expect(found.flightInstanceId).toBe(id);
    await seed(h.prisma);
    const list = await h.call<{ items: unknown[]; page: { nextCursor?: string } }>('ListFlightInstances', { page: { limit: 2 } });
    expect(list.items).toHaveLength(2);
    expect(list.page.nextCursor).toBeTruthy();
    const next = await h.call<{ items: unknown[] }>('ListFlightInstances', { page: { limit: 2, cursor: list.page.nextCursor } });
    expect(next.items).toHaveLength(2);
    await expect(h.call('GetFlightInstance', { flightInstanceId: '00000000-0000-4000-8000-000000000000' }))
      .rejects.toMatchObject({ code: 5 });
  });

  it('INV-06: Upsert actualiza capacidad sin tocar held/sold; no permite bajar de lo comprometido', async () => {
    const id = await createFlight(h, 5);
    const flight = await h.call<{ segment: { flightNumber: string; departure: { at: string }; arrival: { at: string } } }>(
      'GetFlightInstance', { flightInstanceId: id }
    );
    const resend = (capacity: number) => h.call('UpsertFlightInstance', {
      flightInstanceId: id, flightNumber: flight.segment.flightNumber, departureIata: 'UIO', arrivalIata: 'GYE',
      departureAt: flight.segment.departure.at, arrivalAt: flight.segment.arrival.at, cabins: [{ cabinClass: 'ECONOMY', capacity }]
    }, ADMIN);
    await h.prisma.cabinInventory.update({ where: cabinKey(id), data: { held: 2, sold: 1 } });
    await expect(resend(2)).rejects.toMatchObject({ code: 3 });
    await resend(9);
    expect(await h.prisma.cabinInventory.findUniqueOrThrow({ where: cabinKey(id) })).toMatchObject({ sellable: 9, held: 2, sold: 1 });
  });

  it('INV-06: una instancia cerrada no ofrece disponibilidad', async () => {
    const id = await createFlight(h, 5);
    const flight = await h.call<{ segment: { departure: { at: string } } }>('GetFlightInstance', { flightInstanceId: id });
    const date = flight.segment.departure.at.slice(0, 10);
    const query = () => h.call<{ flights: { segment: { flightInstanceId: string } }[] }>('QueryAvailability', {
      origin: 'UIO', destination: 'GYE', departureDate: date, passengers: mix(1)
    });
    expect((await query()).flights.some((f) => f.segment.flightInstanceId === id)).toBe(true);
    const closed = await h.call<{ closed: boolean }>('CloseFlightInstance', { flightInstanceId: id }, ADMIN);
    expect(closed.closed).toBe(true);
    expect((await query()).flights.some((f) => f.segment.flightInstanceId === id)).toBe(false);
  });
});
