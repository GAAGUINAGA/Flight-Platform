import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { expectV2Response } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, headers, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;

describeReal('F12a-2 D · CHECKED_IN en el panel de operaciones (check-ins reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  beforeAll(async () => { stack = await startStack(); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  /** Vuelo dentro de la ventana de check-in con ECONOMY (1A..1C) y BUSINESS (2A, 2B). */
  const twoCabins = async () => {
    const s = await stack.scenario({ hoursAhead: 36 }); scenarios.push(s);
    await stack.db.inventory.cabinInventory.create({ data: { flightInstanceId: s.flightId, cabinClass: 'BUSINESS', sellable: 3 } });
    await stack.db.pricing.fare.create({ data: { flightInstanceId: s.flightId, cabinClass: 'BUSINESS', brand: 'FLEX', baseFareMinor: 30000, taxesMinor: 2000, rules: { changeable: true, refundable: true }, baggage: { checkedBags: 1 }, extraBagMinor: 5000 } });
    for (const [index, seatNumber] of ['2A', '2B'].entries()) await stack.db.ancillaries.seatLayout.create({ data: { aircraft: s.aircraft, cabinClass: 'BUSINESS', seatNumber, rowNumber: 2, characteristics: index ? ['AISLE'] : ['WINDOW'] } });
    return s;
  };
  /** Reserva de un pasajero en la cabina pedida, con el asiento asignado de esa cabina. */
  const purchase = async (s: Scenario, user: string, cabin: 'ECONOMY' | 'BUSINESS') => {
    const offer = await s.search();
    const brand = cabin === 'ECONOMY' ? 'CLASSIC' : 'FLEX'; const seat = cabin === 'ECONOMY' ? '1A' : '2A';
    const response = await request(stack.server).post('/api/v2/vuelos/offers/hold').set(await headers(stack, s.client, user)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: cabin, fareBrand: brand }], passengersBreakdown: { adults: 1 } });
    expect(response.status).toBe(201);
    const held = { holdId: response.body.holdId, lockedPrice: response.body.lockedPrice, offer };
    const created = await book(stack, s, s.client, user, held, { passengers: [passenger('PAX-1', cabin === 'ECONOMY' ? { assignedSeats: [{ segmentId: offer.segmentId, seatNumber: seat }] } : {})] });
    expect({ status: created.response.status, body: created.response.status === 201 ? 'ok' : created.response.body }).toEqual({ status: 201, body: 'ok' });
    return created.response.body.bookingId as string;
  };
  const checkIn = async (s: Scenario, user: string, bookingId: string) => request(stack.server).post(`/api/v2/vuelos/bookings/${bookingId}/check-in`).set(await headers(stack, s.client, user));
  const cabinsOf = async (s: Scenario) => {
    const res = await request(stack.server).get('/api/v2/vuelos/operaciones/vuelos').query({ date: s.date, origin: s.origin, destination: s.destination }).set(await headers(stack, s.client, undefined, 'flights:ops'));
    expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/operaciones/vuelos', 200, res.body);
    const row = res.body.items.find((item: { flightNumber: string }) => item.flightNumber === s.flightNumber);
    return Object.fromEntries(row.cabins.map((cabin: { cabinClass: string; seatsByStatus: Record<string, number> }) => [cabin.cabinClass, cabin.seatsByStatus])) as Record<string, Record<string, number>>;
  };

  it('V2-D-01 / I: check-ins reales en dos cabinas del mismo vuelo dan conteos CHECKED_IN correctos por cabina y TICKETED con el resto', async () => {
    const s = await twoCabins();
    const economy = await purchase(s, 'u-eco', 'ECONOMY'); const business = await purchase(s, 'u-biz', 'BUSINESS'); await purchase(s, 'u-biz2', 'BUSINESS');
    expect(await cabinsOf(s)).toMatchObject({ ECONOMY: { TICKETED: 1, CHECKED_IN: 0 }, BUSINESS: { TICKETED: 2, CHECKED_IN: 0 } });
    expect((await checkIn(s, 'u-eco', economy)).status).toBe(200); expect((await checkIn(s, 'u-biz', business)).status).toBe(200);
    expect(await cabinsOf(s)).toEqual({
      ECONOMY: { AVAILABLE: 4, HELD: 0, BOOKED: 0, TICKETED: 0, CHECKED_IN: 1, BOARDED: 0 },
      BUSINESS: { AVAILABLE: 1, HELD: 0, BOOKED: 0, TICKETED: 1, CHECKED_IN: 1, BOARDED: 0 }
    });
  }, 240_000);

  it('V2-D-02 / I: repetir el check-in no cuenta doble', async () => {
    const s = await twoCabins(); const id = await purchase(s, 'u1', 'BUSINESS');
    expect((await checkIn(s, 'u1', id)).status).toBe(200);
    const again = await checkIn(s, 'u1', id); expect([200, 409]).toContain(again.status);
    expect((await cabinsOf(s)).BUSINESS).toMatchObject({ TICKETED: 0, CHECKED_IN: 1 });
    expect(await stack.db.operations.boardingPass.count({ where: { bookingId: id } })).toBe(1);
  }, 180_000);

  it('V2-D-02b / I: reemitir el pase del mismo pasajero (otro id y código) no cambia el conteo: cuenta pasajeros únicos, no pases', async () => {
    const s = await twoCabins(); const id = await purchase(s, 'u1', 'BUSINESS'); expect((await checkIn(s, 'u1', id)).status).toBe(200);
    const original = await stack.db.operations.boardingPass.findFirstOrThrow({ where: { bookingId: id } });
    expect((await cabinsOf(s)).BUSINESS).toMatchObject({ CHECKED_IN: 1 });
    await stack.db.operations.boardingPass.update({ where: { id: original.id }, data: { valid: false } });
    expect((await cabinsOf(s)).BUSINESS).toMatchObject({ CHECKED_IN: 0, TICKETED: 1 });
    await stack.db.operations.boardingPass.update({ where: { id: original.id }, data: { valid: true, barcode: `M1/${randomUUID()}/${original.seat}` } });
    expect(await stack.db.operations.boardingPass.count({ where: { bookingId: id } })).toBe(1);
    expect((await cabinsOf(s)).BUSINESS).toMatchObject({ CHECKED_IN: 1, TICKETED: 0 });
    expect((await checkIn(s, 'u1', id)).status).toBeLessThan(500);
    expect((await cabinsOf(s)).BUSINESS).toMatchObject({ CHECKED_IN: 1, TICKETED: 0 });
  }, 180_000);

  it('V2-D-03 / I: un vuelo vendido sin check-ins muestra CHECKED_IN en 0 y un vuelo sin ventas también', async () => {
    const s = await twoCabins(); await purchase(s, 'u1', 'ECONOMY');
    expect(await cabinsOf(s)).toMatchObject({ ECONOMY: { TICKETED: 1, CHECKED_IN: 0 }, BUSINESS: { TICKETED: 0, CHECKED_IN: 0 } });
    const empty = await stack.scenario(); scenarios.push(empty);
    expect(await cabinsOf(empty)).toMatchObject({ ECONOMY: { CHECKED_IN: 0 } });
  }, 180_000);

  it('V2-D-04 / I: un check-in anterior sin cabina registrada no se atribuye a ninguna cabina', async () => {
    const s = await twoCabins(); const id = await purchase(s, 'u1', 'ECONOMY'); expect((await checkIn(s, 'u1', id)).status).toBe(200);
    expect((await cabinsOf(s)).ECONOMY).toMatchObject({ CHECKED_IN: 1 });
    expect(await stack.db.operations.boardingPass.findFirstOrThrow({ where: { bookingId: id } })).toMatchObject({ cabinClass: 'ECONOMY' });
    await stack.db.operations.boardingPass.updateMany({ where: { bookingId: id }, data: { cabinClass: null } });
    expect(await cabinsOf(s)).toMatchObject({ ECONOMY: { TICKETED: 1, CHECKED_IN: 0 }, BUSINESS: { CHECKED_IN: 0 } });
  }, 180_000);

  it('V2-D-05 / I: la cabina queda guardada en el pase de cada pasajero tomada de la reserva', async () => {
    const s = await twoCabins(); const eco = await purchase(s, 'u1', 'ECONOMY'); const biz = await purchase(s, 'u2', 'BUSINESS');
    await checkIn(s, 'u1', eco); await checkIn(s, 'u2', biz);
    const rows = await stack.db.operations.boardingPass.findMany({ where: { bookingId: { in: [eco, biz] } }, select: { bookingId: true, cabinClass: true } });
    expect(Object.fromEntries(rows.map((row) => [row.bookingId, row.cabinClass]))).toEqual({ [eco]: 'ECONOMY', [biz]: 'BUSINESS' });
  }, 180_000);
});
