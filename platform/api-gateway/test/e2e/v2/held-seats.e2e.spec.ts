import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { expectSchema } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, getBooking, headers, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;

describeReal('F12b2fix · asientos apartados en el hold (escenarios de Booking, servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  beforeAll(async () => { stack = await startStack(); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  type Offer = Awaited<ReturnType<Scenario['search']>>;
  const post = async (s: Scenario, user: string, offer: Offer, extra: Record<string, unknown>) => request(stack.server).post('/api/v2/vuelos/offers/hold').set(await headers(stack, s.client, user)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 }, ...extra });
  const seatOf = async (offer: Offer, number: string) => {
    const res = await request(stack.server).get(`/api/v2/vuelos/offers/${offer.offerId}/seatmap`).query({ segmentId: offer.segmentId }); expect(res.status).toBe(200);
    return res.body.cabins.flatMap((cabin: { rows: Array<{ seats: Array<Record<string, unknown>> }> }) => cabin.rows.flatMap((row) => row.seats)).find((seat: Record<string, unknown>) => seat.seatNumber === number) as { status: string; isAvailable: boolean };
  };
  const seats = (offer: Offer, number = '1A') => ({ assignedSeats: [{ segmentId: offer.segmentId, seatNumber: number }] });

  it('V2-HELD-01 hold con asiento ⇒ 201 y el mapa muestra HELD; el mismo asiento en otro hold ⇒ 409 SEAT_TAKEN; al liberar vuelve a AVAILABLE', async () => {
    const s = await stack.scenario(); scenarios.push(s); const offer = await s.search();
    const first = await post(s, 'u1', offer, seats(offer)); expect(first.status).toBe(201); expectSchema('HoldResponse', first.body);
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'HELD', isAvailable: false });
    const second = await post(s, 'u2', offer, seats(offer)); expect(second.status).toBe(409); expect(second.body.code).toBe('SEAT_TAKEN'); expectSchema('ProblemDetails', second.body);
    expect(second.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(await stack.db.inventory.hold.count({ where: { ownerId: { contains: 'u2' }, status: 'HELD' } })).toBe(0);
    const released = await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${first.body.holdId}`).set(await headers(stack, s.client, 'u1')); expect(released.status).toBe(204);
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'AVAILABLE', isAvailable: true });
    expect((await post(s, 'u2', offer, seats(offer))).status).toBe(201);
  }, 240_000);

  it('V2-HELD-02 sin asientos o con otro segmento/formato el hold sigue siendo el de siempre o 422 sin dejar asientos', async () => {
    const s = await stack.scenario(); scenarios.push(s); const offer = await s.search();
    expect((await post(s, 'u1', offer, { assignedSeats: [] })).status).toBe(201);
    const bad = await post(s, 'u2', offer, { assignedSeats: [{ segmentId: randomUUID(), seatNumber: '1A' }] }); expect(bad.status).toBe(422); expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'AVAILABLE' });
  }, 240_000);

  it('V2-HELD-03 hold → reserva sin asientos: se usan los del hold, el pasajero los muestra y pasan de HELD a TICKETED (sin 409 contra su propio hold)', async () => {
    const s = await stack.scenario(); scenarios.push(s); const offer = await s.search();
    const held = await post(s, 'u1', offer, seats(offer, '1B')); expect(held.status).toBe(201);
    const created = await book(stack, s, s.client, 'u1', { holdId: held.body.holdId, lockedPrice: held.body.lockedPrice, offer }, { passengers: [passenger('PAX-1')] });
    expect(created.response.status).toBe(201);
    const booking = await getBooking(stack, s.client, 'u1', created.response.body.bookingId);
    expect(booking.body.passengers[0].assignedSeats).toEqual([expect.objectContaining({ seatNumber: '1B' })]);
    expect(await seatOf(offer, '1B')).toMatchObject({ status: 'TICKETED', isAvailable: false });
  }, 240_000);

  it('V2-HELD-04 hold → reserva con otros asientos: se liberan los del hold y se toman los nuevos', async () => {
    const s = await stack.scenario(); scenarios.push(s); const offer = await s.search();
    const held = await post(s, 'u1', offer, seats(offer, '1A')); expect(held.status).toBe(201);
    const created = await book(stack, s, s.client, 'u1', { holdId: held.body.holdId, lockedPrice: held.body.lockedPrice, offer }, { passengers: [passenger('PAX-1', seats(offer, '1C'))] });
    expect(created.response.status).toBe(201);
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'AVAILABLE' }); expect(await seatOf(offer, '1C')).toMatchObject({ status: 'TICKETED' });
  }, 240_000);

  it('V2-HELD-05 vencimiento sin liberación: con el hold vencido el mapa lo ve AVAILABLE y otro hold puede tomarlo', async () => {
    const s = await stack.scenario(); scenarios.push(s); const offer = await s.search();
    const held = await post(s, 'u1', offer, seats(offer, '1A')); expect(held.status).toBe(201);
    await stack.db.ancillaries.seatAssignment.updateMany({ where: { holdId: held.body.holdId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'AVAILABLE', isAvailable: true });
    expect((await post(s, 'u2', offer, seats(offer, '1A'))).status).toBe(201);
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'HELD' });
  }, 240_000);

  it('V2-HELD-06 el mapa de v1 no cambia de forma: el asiento apartado es isAvailable false sin status', async () => {
    const s = await stack.scenario(); scenarios.push(s); const offer = await s.search();
    expect((await post(s, 'u1', offer, seats(offer, '1A'))).status).toBe(201);
    const res = await request(stack.server).get(`/flights/v1/offers/${offer.offerId}/seatmap`).query({ segmentId: offer.segmentId }); expect(res.status).toBe(200);
    const seat = res.body.cabins.flatMap((cabin: { rows: Array<{ seats: Array<Record<string, unknown>> }> }) => cabin.rows.flatMap((row) => row.seats)).find((x: Record<string, unknown>) => x.seatNumber === '1A');
    expect(seat).toMatchObject({ isAvailable: false }); expect(seat).not.toHaveProperty('status');
  }, 240_000);

  it('V2-HELD-07 después del check-in el asiento sale CHECKED_IN', async () => {
    const s = await stack.scenario({ hoursAhead: 36 }); scenarios.push(s); const offer = await s.search();
    const held = await post(s, 'u1', offer, seats(offer, '1A')); expect(held.status).toBe(201);
    const created = await book(stack, s, s.client, 'u1', { holdId: held.body.holdId, lockedPrice: held.body.lockedPrice, offer }, { passengers: [passenger('PAX-1', seats(offer, '1A'))] }); expect(created.response.status).toBe(201);
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'TICKETED' });
    expect((await request(stack.server).post(`/api/v2/vuelos/bookings/${created.response.body.bookingId}/check-in`).set(await headers(stack, s.client, 'u1'))).status).toBe(200);
    expect(await seatOf(offer, '1A')).toMatchObject({ status: 'CHECKED_IN', isAvailable: false });
  }, 240_000);
});
