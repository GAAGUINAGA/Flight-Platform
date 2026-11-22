import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { startStack, type Scenario, type Stack } from './stack';
import { book, getBooking, headers, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
type Cabin = 'BUSINESS' | 'PREMIUM_ECONOMY' | 'FIRST';
const CABINS: Cabin[] = ['BUSINESS', 'PREMIUM_ECONOMY', 'FIRST'];

/**
 * fix-compra-ejecutiva: la compra por v2 (como Booking) en cada cabina que no es ECONOMY. Hasta ahora los escenarios solo vendían ECONOMY,
 * y por eso nadie vio que Reservation mandaba la cabina ECONOMY fija al reservar el asiento apartado en el hold (SEAT_CABIN_MISMATCH → 400 en producción).
 */
describeReal('fix-compra-ejecutiva · compra por v2 en cada cabina (servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  beforeAll(async () => { stack = await startStack(); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  type Offer = Awaited<ReturnType<Scenario['search']>>;
  const post = async (s: Scenario, user: string, offer: Offer, extra: Record<string, unknown>) => request(stack.server).post('/api/v2/vuelos/offers/hold').set(await headers(stack, s.client, user)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 }, ...extra });
  const seatOf = async (offer: Offer, number: string) => {
    const res = await request(stack.server).get(`/api/v2/vuelos/offers/${offer.offerId}/seatmap`).query({ segmentId: offer.segmentId }); expect(res.status).toBe(200);
    return res.body.cabins.flatMap((cabin: { rows: Array<{ seats: Array<Record<string, unknown>> }> }) => cabin.rows.flatMap((row) => row.seats)).find((seat: Record<string, unknown>) => seat.seatNumber === number) as { status: string; isAvailable: boolean };
  };

  for (const cabin of CABINS) {
    it(`V2-CAB-${cabin} hold con asiento → reserva sin asientos: 201, CONFIRMED, el asiento queda TICKETED y registrado con la cabina ${cabin}`, async () => {
      const s = await stack.scenario({ cabin }); scenarios.push(s); const offer = await s.search();
      expect(offer.cabinClass).toBe(cabin);
      const held = await post(s, 'u1', offer, { assignedSeats: [{ segmentId: offer.segmentId, seatNumber: '1A' }] }); expect(held.status).toBe(201);
      const created = await book(stack, s, s.client, 'u1', { holdId: held.body.holdId, lockedPrice: held.body.lockedPrice, offer }, { passengers: [passenger('PAX-1')] });
      expect(created.response.status).toBe(201);
      const booking = await getBooking(stack, s.client, 'u1', created.response.body.bookingId);
      expect(booking.body.status).toBe('CONFIRMED');
      expect(booking.body.passengers[0].assignedSeats).toEqual([expect.objectContaining({ seatNumber: '1A' })]);
      expect(await seatOf(offer, '1A')).toMatchObject({ status: 'TICKETED', isAvailable: false });
      expect(await stack.db.ancillaries.seatAssignment.findFirst({ where: { bookingId: created.response.body.bookingId, status: { not: 'RELEASED' } } })).toMatchObject({ cabinClass: cabin });
    }, 240_000);
  }

  it('V2-CAB-BUSINESS-SIN-ASIENTO compra en BUSINESS sin elegir asiento: 201 y CONFIRMED', async () => {
    const s = await stack.scenario({ cabin: 'BUSINESS' }); scenarios.push(s); const offer = await s.search();
    const held = await post(s, 'u1', offer, {}); expect(held.status).toBe(201);
    const created = await book(stack, s, s.client, 'u1', { holdId: held.body.holdId, lockedPrice: held.body.lockedPrice, offer }, { passengers: [passenger('PAX-1')] });
    expect(created.response.status).toBe(201);
    expect((await getBooking(stack, s.client, 'u1', created.response.body.bookingId)).body.status).toBe('CONFIRMED');
  }, 240_000);

  it('V2-CAB-BUSINESS-ASIENTO-EXPLICITO compra en BUSINESS eligiendo el asiento en la reserva: 201 y el asiento lleva la cabina BUSINESS', async () => {
    const s = await stack.scenario({ cabin: 'BUSINESS' }); scenarios.push(s); const offer = await s.search();
    const held = await post(s, 'u1', offer, {}); expect(held.status).toBe(201);
    const created = await book(stack, s, s.client, 'u1', { holdId: held.body.holdId, lockedPrice: held.body.lockedPrice, offer }, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId: offer.segmentId, seatNumber: '1B' }] })] });
    expect(created.response.status).toBe(201);
    expect(await stack.db.ancillaries.seatAssignment.findFirst({ where: { bookingId: created.response.body.bookingId, status: { not: 'RELEASED' } } })).toMatchObject({ seatNumber: '1B', cabinClass: 'BUSINESS' });
  }, 240_000);
});
