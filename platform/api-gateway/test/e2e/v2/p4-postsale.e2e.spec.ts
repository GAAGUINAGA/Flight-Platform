import { createHmac, randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { buildCloudEvent, type WebhookPayload } from '../../../../../microservices/webhooks-service/src/domain/webhook';
import { expectSchema, expectV2Response, type TestClient } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, getBooking, headers, hold, newReference, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const SECRET = `booking-shared-secret-${randomUUID()}`;
const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
const ALL_EVENTS = ['booking.baggage_added', 'booking.changed', 'booking.cancelled', 'booking.seat_changed', 'booking.checked_in'];

describeReal('F12a P4 · postventa, asientos y check-in v2 (contra servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  const scenario = async (options: Parameters<Stack['scenario']>[0] = {}) => { const value = await stack.scenario(options); scenarios.push(value); return value; };
  beforeAll(async () => { stack = await startStack({ BOOKING_EVENTS_SECRET: SECRET }); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  const purchase = async (s: Scenario, user = 'u1', options: Parameters<typeof book>[5] = {}, breakdown?: Record<string, number>, extra: Record<string, unknown> = {}) => { const held = await hold(stack, s, s.client, user, extra, breakdown); const result = await book(stack, s, s.client, user, held, options); return { held, ...result, id: result.response.body.bookingId as string, total: held.lockedPrice.total }; };
  const path = (id: string, tail: string) => `/api/v2/vuelos/bookings/${id}/${tail}`;
  const get = async (url: string, client: TestClient, user = 'u1') => request(stack.server).get(url).set(await headers(stack, client, user));
  const post = async (url: string, client: TestClient, body: object | undefined, user = 'u1', key: string | null = randomUUID(), scope?: string) => { let call = request(stack.server).post(url).set(await headers(stack, client, user, scope)); if (key) call = call.set('Idempotency-Key', key); return body === undefined ? call : call.send(body); };
  const events = async (client: TestClient) => (await stack.db.webhooks.event.findMany({ where: { ownerId: { startsWith: client.clientId } }, orderBy: { seq: 'asc' } })).map((row) => ({ type: row.eventType, data: row.data as Record<string, unknown> }));
  const deliveries = async (client: TestClient) => (await stack.db.webhooks.delivery.findMany({ where: { subscription: { ownerId: client.clientId } } })).map((row) => row.payload as unknown as WebhookPayload);
  const sendEvent = (type: string, data: Record<string, unknown>, id = `evt-bkp-${randomUUID()}`) => { const raw = JSON.stringify({ specversion: '1.0', type, source: '/booking', id, time: new Date().toISOString(), correlationid: `corr-${randomUUID()}`, data }); return request(stack.server).post('/api/v2/vuelos/booking-events').set('Content-Type', 'application/cloudevents+json').set('X-Webhook-Signature', sign(raw)).send(raw); };

  describe('equipaje', () => {
    it('V2-P4-01 lista las opciones de equipaje con el id de pasajero de Booking y cumple BaggageOptionsResponse', async () => {
      const s = await scenario(); const p = await purchase(s); const res = await get(path(p.id, 'baggage-options'), s.client);
      expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}/baggage-options', 200, res.body); expect(res.body[0]).toMatchObject({ passengerId: 'PAX-1', price: { currency: 'USD', total: '50.00' }, maxAllowed: 3, alreadyPurchased: 0 });
    }, 90_000);
    it('V2-P4-02 compra una maleta con el pago confirmado: 200, total acumulado y booking.baggage_added con importe y referencia', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, ALL_EVENTS); const p = await purchase(s); const reference = newReference(); stack.payments.confirmed(reference, '50.00');
      const res = await post(path(p.id, 'baggage'), s.client, { passengerId: 'PAX-1', itineraryId: p.held.offer.itineraryId, quantity: 1, payment: { paymentReference: reference } });
      expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/bookings/{bookingId}/baggage', 200, res.body); expect(res.body).toMatchObject({ passengerId: 'PAX-1', totalBaggage: 1 });
      const sent = (await deliveries(s.client)).find((e) => e.eventType === 'booking.baggage_added'); expect(sent?.extra).toMatchObject({ changeType: 'BAGGAGE', amountCharged: { currency: 'USD', total: '50.00' }, paymentReference: reference });
      expectSchema('EventBookingChanged', buildCloudEvent(sent!, 'gabatair'));
    }, 120_000);
    it('V2-P4-03 con el pago pendiente responde 422 PAYMENT_NOT_AUTHORIZED y no agrega ninguna maleta', async () => {
      const s = await scenario(); const p = await purchase(s); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '50.00' });
      const res = await post(path(p.id, 'baggage'), s.client, { passengerId: 'PAX-1', itineraryId: p.held.offer.itineraryId, quantity: 1, payment: { paymentReference: reference } });
      expect(res.status).toBe(422); expect(res.body.code).toBe('PAYMENT_NOT_AUTHORIZED'); expectV2Response('POST', '/vuelos/bookings/{bookingId}/baggage', 422, res.body);
      expect((await get(path(p.id, 'baggage-options'), s.client)).body[0].alreadyPurchased).toBe(0);
    }, 120_000);
    it('V2-P4-04 con el pago fallido, inexistente o de otro monto no se agrega ninguna maleta', async () => {
      const s = await scenario(); const p = await purchase(s); const body = (reference: string) => ({ passengerId: 'PAX-1', itineraryId: p.held.offer.itineraryId, quantity: 1, payment: { paymentReference: reference } });
      const failed = newReference(); stack.payments.set(failed, { estado: 'FALLIDO' }); const wrong = newReference(); stack.payments.confirmed(wrong, '10.00');
      expect((await post(path(p.id, 'baggage'), s.client, body(failed))).body.code).toBe('PAYMENT_NOT_AUTHORIZED'); expect((await post(path(p.id, 'baggage'), s.client, body(newReference()))).body.code).toBe('PAYMENT_NOT_AUTHORIZED'); const mismatch = await post(path(p.id, 'baggage'), s.client, body(wrong));
      expect(mismatch.status).toBe(422); expect(mismatch.body.code).toBe('AMOUNT_MISMATCH'); expect((await get(path(p.id, 'baggage-options'), s.client)).body[0].alreadyPurchased).toBe(0);
    }, 120_000);
    it('V2-P4-05 más de 3 maletas, por compra o acumuladas, responde 422 BAGGAGE_LIMIT_EXCEEDED (v2) y nada se cobra de más', async () => {
      const s = await scenario(); const p = await purchase(s); const itineraryId = p.held.offer.itineraryId;
      const four = await post(path(p.id, 'baggage'), s.client, { passengerId: 'PAX-1', itineraryId, quantity: 4, payment: { paymentReference: newReference() } }); expect(four.status).toBe(422); expect(four.body.code).toBe('BAGGAGE_LIMIT_EXCEEDED');
      const reference = newReference(); stack.payments.confirmed(reference, '150.00'); expect((await post(path(p.id, 'baggage'), s.client, { passengerId: 'PAX-1', itineraryId, quantity: 3, payment: { paymentReference: reference } })).status).toBe(200);
      const more = newReference(); stack.payments.confirmed(more, '50.00'); const over = await post(path(p.id, 'baggage'), s.client, { passengerId: 'PAX-1', itineraryId, quantity: 1, payment: { paymentReference: more } });
      expect(over.status).toBe(422); expect(over.body.code).toBe('BAGGAGE_LIMIT_EXCEEDED'); expectV2Response('POST', '/vuelos/bookings/{bookingId}/baggage', 422, over.body);
    }, 150_000);
    it('V2-P4-06 un reintento con la misma Idempotency-Key devuelve 200 Idempotent-Replayed y no cobra otra vez', async () => {
      const s = await scenario(); const p = await purchase(s); const reference = newReference(); stack.payments.confirmed(reference, '50.00'); const key = randomUUID(); const body = { passengerId: 'PAX-1', itineraryId: p.held.offer.itineraryId, quantity: 1, payment: { paymentReference: reference } };
      const first = await post(path(p.id, 'baggage'), s.client, body, 'u1', key); const again = await post(path(p.id, 'baggage'), s.client, body, 'u1', key);
      expect([first.status, again.status]).toEqual([200, 200]); expect(again.headers['idempotent-replayed']).toBe('true'); expect(again.body).toEqual(first.body); expect((await get(path(p.id, 'baggage-options'), s.client)).body[0].alreadyPurchased).toBe(1);
      const other = await post(path(p.id, 'baggage'), s.client, { ...body, quantity: 2 }, 'u1', key); expect(other.status).toBe(409); expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    }, 120_000);
    it('V2-P4-07 un pasajero que no es de la reserva responde 400, una reserva ajena 404 y un cuerpo inválido 400', async () => {
      const s = await scenario(); const p = await purchase(s); const itineraryId = p.held.offer.itineraryId; const ok = { passengerId: 'PAX-1', itineraryId, quantity: 1, payment: { paymentReference: newReference() } };
      expect((await post(path(p.id, 'baggage'), s.client, { ...ok, passengerId: 'PAX-9' })).status).toBe(400); expect((await post(path(p.id, 'baggage'), s.client, ok, 'u2')).status).toBe(404);
      for (const bad of [{ ...ok, quantity: 0 }, { passengerId: 'PAX-1', quantity: 1 }, { ...ok, payment: {} }]) expect((await post(path(p.id, 'baggage'), s.client, bad)).status).toBe(400);
      expect((await post(path(p.id, 'baggage'), s.client, ok, 'u1', null)).status).toBe(400);
    }, 120_000);
  });

  describe('cambio de fecha', () => {
    const route = async () => { const first = await scenario({ changeable: true }); const second = await scenario({ origin: first.origin, destination: first.destination, hoursAhead: 6 * 24, changeable: true }); return { first, second }; };
    const search = async (s: Scenario, id: string, itineraryId: string, date: string) => post(path(id, 'date-change/search'), s.client, { changes: [{ itineraryId, newDepartureDate: date }] }, 'u1', null);
    it('V2-P4-10 busca ofertas de cambio: cumple DateChangeSearchResponse, sin ids internos', async () => {
      const { first, second } = await route(); const p = await purchase(first); const res = await search(first, p.id, p.held.offer.itineraryId, second.date);
      expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/bookings/{bookingId}/date-change/search', 200, res.body); expect(res.body.length).toBeGreaterThan(0); expect(JSON.stringify(res.body)).not.toContain('flightInstanceId'); expect(res.body[0].priceDifference.totalToPay).toMatch(/^\d+\.\d{2}$/);
    }, 150_000);
    it('V2-P4-11 confirma el cambio con el pago de la diferencia: 200 BookingDetail con el vuelo nuevo y booking.changed', async () => {
      const { first, second } = await route(); await stack.subscribe(first.client.clientId, ALL_EVENTS); const p = await purchase(first); const offers = (await search(first, p.id, p.held.offer.itineraryId, second.date)).body; const offer = offers.find((o: { segments: Array<{ flightNumber: string }> }) => o.segments[0].flightNumber === second.flightNumber);
      expect(offer).toBeDefined(); const reference = newReference(); stack.payments.confirmed(reference, offer.priceDifference.totalToPay);
      const res = await post(path(p.id, 'date-change'), first.client, { changeOfferId: offer.changeOfferId, payment: { paymentReference: reference } });
      expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/bookings/{bookingId}/date-change', 200, res.body); expect(res.body.status).toBe('CONFIRMED'); expect(res.body.itineraries[0].segments[0].flightNumber).toBe(second.flightNumber); expect(res.body.tickets.map((t: { status: string }) => t.status).sort()).toEqual(['ISSUED', 'VOIDED']);
      const sent = (await deliveries(first.client)).find((e) => e.eventType === 'booking.changed'); expect(sent?.extra).toMatchObject({ changeType: 'DATE_CHANGE', amountCharged: { total: offer.priceDifference.totalToPay }, paymentReference: reference }); expectSchema('EventBookingChanged', buildCloudEvent(sent!, 'gabatair'));
    }, 240_000);
    it('V2-P4-12 sin el pago de la diferencia no cambia la fecha: 422 y la reserva queda igual', async () => {
      const { first, second } = await route(); const p = await purchase(first); const offer = (await search(first, p.id, p.held.offer.itineraryId, second.date)).body[0];
      const res = await post(path(p.id, 'date-change'), first.client, { changeOfferId: offer.changeOfferId }); expect(res.status).toBe(422); expect(['PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED']).toContain(res.body.code);
      const pending = newReference(); stack.payments.set(pending, { estado: 'PENDIENTE', monto: offer.priceDifference.totalToPay }); const second2 = await post(path(p.id, 'date-change'), first.client, { changeOfferId: offer.changeOfferId, payment: { paymentReference: pending } }); expect(second2.status).toBe(422);
      expect((await getBooking(stack, first.client, 'u1', p.id)).body.itineraries[0].segments[0].flightNumber).toBe(first.flightNumber);
    }, 240_000);
    it('V2-P4-13 una oferta de cambio desconocida responde 404 o 410 y una tarifa no cambiable 409 FARE_NOT_CHANGEABLE', async () => {
      const s = await scenario({ changeable: false }); const p = await purchase(s); const fixed = await post(path(p.id, 'date-change'), s.client, { changeOfferId: randomUUID() }); expect(fixed.status).toBe(409); expect(fixed.body.code).toBe('FARE_NOT_CHANGEABLE');
      const t = await scenario({ changeable: true }); const q = await purchase(t); const unknown = await post(path(q.id, 'date-change'), t.client, { changeOfferId: randomUUID() }); expect([404, 410]).toContain(unknown.status); expectSchema('ProblemDetails', unknown.body);
    }, 150_000);
  });

  describe('cancelación', () => {
    const quoteOf = async (s: Scenario, id: string) => (await get(path(id, 'cancellation-quote'), s.client)).body as { quoteId: string; refundAmount: string; penaltyAmount: string; currency: string; isRefundable: boolean };
    it('V2-P4-20 cotiza la cancelación: cumple CancellationQuoteResponse; otro usuario 404', async () => {
      const s = await scenario(); const p = await purchase(s); const res = await get(path(p.id, 'cancellation-quote'), s.client); expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}/cancellation-quote', 200, res.body);
      expect((await get(path(p.id, 'cancellation-quote'), s.client, 'u2')).status).toBe(404);
    }, 90_000);
    it('V2-P4-21 cancela con la cotización: 200 CancelBookingResponse, reembolso informado, boletos anulados, cupo devuelto y booking.cancelled', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, ALL_EVENTS); const p = await purchase(s); const quote = await quoteOf(s, p.id);
      const res = await post(path(p.id, 'cancel'), s.client, { quoteId: quote.quoteId, reasonCode: 'CUSTOMER_REQUEST', reason: 'cambio de planes' }, 'u1', randomUUID(), 'flights:cancel flights:read');
      expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/bookings/{bookingId}/cancel', 200, res.body);
      expect(res.body).toMatchObject({ bookingId: p.id, status: 'CANCELLED', reasonCode: 'CUSTOMER_REQUEST', refund: { amount: quote.refundAmount, penaltyAmount: quote.penaltyAmount, currency: 'USD', originalPaymentReference: p.reference }, inventoryRestoration: { status: 'RESTORED', seatsReleased: 1, newSeatStatus: 'AVAILABLE' } });
      expect(res.body.refund.refundId).toMatch(/^REF-VUE-[0-9A-F]{8}$/); expect(res.body.ticketsVoided).toHaveLength(1);
      expect(await stack.db.inventory.cabinInventory.findFirst({ where: { flightInstanceId: s.flightId }, select: { held: true, sold: true } })).toEqual({ held: 0, sold: 0 }); expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('CANCELLED');
      const sent = (await deliveries(s.client)).find((e) => e.eventType === 'booking.cancelled'); expect(sent?.extra).toMatchObject({ reasonCode: 'CUSTOMER_REQUEST', refundId: res.body.refund.refundId, seatsReleased: 1 }); expect(sent?.data?.refundAmount).toBe(quote.refundAmount); expectSchema('EventBookingCancelled', buildCloudEvent(sent!, 'gabatair'));
    }, 120_000);
    it('V2-P4-22 sin quoteId solo se admite con SAGA_COMPENSATION o FLIGHT_CANCELLED; con otra causa responde 400', async () => {
      const s = await scenario(); const p = await purchase(s);
      for (const body of [{}, { reasonCode: 'CUSTOMER_REQUEST' }, { reasonCode: 'OTHER' }]) { const res = await post(path(p.id, 'cancel'), s.client, body); expect({ body, status: res.status }).toEqual({ body, status: 400 }); }
      expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('CONFIRMED');
    }, 120_000);
    it('V2-P4-23 SAGA_COMPENSATION dentro de la ventana no paga penalidad: reembolso total sin cotización previa', async () => {
      const s = await scenario(); const p = await purchase(s); const normal = await quoteOf(s, p.id); const res = await post(path(p.id, 'cancel'), s.client, { reasonCode: 'SAGA_COMPENSATION', reason: 'Falló la reserva del hotel' });
      expect(res.status).toBe(200); expect(res.body).toMatchObject({ status: 'CANCELLED', reasonCode: 'SAGA_COMPENSATION', refund: { amount: p.total, penaltyAmount: '0.00', percentage: 100, status: 'CALCULATED' } }); expect(normal.quoteId).toBeDefined();
    }, 120_000);
    it('V2-P4-24 SAGA_COMPENSATION fuera de la ventana aplica la penalidad de la tarifa', async () => {
      const s = await scenario(); const p = await purchase(s); const normal = await quoteOf(s, p.id);
      const first = await stack.db.reservation.reservation.findUniqueOrThrow({ where: { id: p.id }, include: { changes: { orderBy: { changedAt: 'asc' } } } }); await stack.db.reservation.reservationChange.update({ where: { id: first.changes[0].id }, data: { changedAt: new Date(Date.now() - 5 * 3_600_000) } });
      const res = await post(path(p.id, 'cancel'), s.client, { reasonCode: 'SAGA_COMPENSATION' }); expect(res.status).toBe(200); expect(res.body.refund).toMatchObject({ amount: normal.refundAmount, penaltyAmount: normal.penaltyAmount });
    }, 120_000);
    it('V2-P4-25 FLIGHT_CANCELLED sin cotización devuelve el total aunque la causa sea de la aerolínea', async () => {
      const s = await scenario(); const p = await purchase(s); const res = await post(path(p.id, 'cancel'), s.client, { reasonCode: 'FLIGHT_CANCELLED' }); expect(res.status).toBe(200); expect(res.body.refund).toMatchObject({ amount: p.total, penaltyAmount: '0.00' });
    }, 120_000);
    it('V2-P4-26 una cotización ajena o inexistente responde 409 QUOTE_EXPIRED y no cancela', async () => {
      const a = await scenario(); const b = await scenario(); const pa = await purchase(a); const pb = await purchase(b); const quoteB = await quoteOf(b, pb.id);
      for (const quoteId of [quoteB.quoteId, randomUUID()]) { const res = await post(path(pa.id, 'cancel'), a.client, { quoteId, reasonCode: 'CUSTOMER_REQUEST' }); expect({ quoteId, status: res.status, code: res.body.code }).toEqual({ quoteId, status: 409, code: 'QUOTE_EXPIRED' }); }
      expect((await getBooking(stack, a.client, 'u1', pa.id)).body.status).toBe('CONFIRMED');
    }, 180_000);
    it('V2-P4-27 cancelar otra vez responde 409 ALREADY_CANCELLED y repetir la misma clave 200 con la respuesta guardada', async () => {
      const s = await scenario(); const p = await purchase(s); const quote = await quoteOf(s, p.id); const key = randomUUID(); const body = { quoteId: quote.quoteId, reasonCode: 'CUSTOMER_REQUEST' };
      const first = await post(path(p.id, 'cancel'), s.client, body, 'u1', key); const replay = await post(path(p.id, 'cancel'), s.client, body, 'u1', key); const again = await post(path(p.id, 'cancel'), s.client, { reasonCode: 'FLIGHT_CANCELLED' });
      expect(first.status).toBe(200); expect(replay.status).toBe(200); expect(replay.headers['idempotent-replayed']).toBe('true'); expect(replay.body).toEqual(first.body); expect(again.status).toBe(409); expect(again.body.code).toBe('ALREADY_CANCELLED'); expectV2Response('POST', '/vuelos/bookings/{bookingId}/cancel', 409, again.body);
    }, 150_000);
    it('V2-P4-28 una reserva que aún no está confirmada responde 409 BOOKING_NOT_CANCELLABLE', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '120.00' }); const p = await purchase(s, 'u1', { reference, confirm: false });
      const res = await post(path(p.id, 'cancel'), s.client, { reasonCode: 'SAGA_COMPENSATION' }); expect(res.status).toBe(409); expect(res.body.code).toBe('BOOKING_NOT_CANCELLABLE');
    }, 120_000);
    it('V2-P4-29 exige el scope flights:cancel, rechaza reservas ajenas y la Idempotency-Key', async () => {
      const s = await scenario(); const p = await purchase(s); const reader = await stack.newClient(['flights:read', 'flights:book']);
      expect((await post(path(p.id, 'cancel'), reader, { reasonCode: 'FLIGHT_CANCELLED' })).status).toBe(403); expect((await post(path(p.id, 'cancel'), s.client, { reasonCode: 'FLIGHT_CANCELLED' }, 'u2')).status).toBe(404);
      expect((await post(path(p.id, 'cancel'), s.client, { reasonCode: 'FLIGHT_CANCELLED' }, 'u1', null)).status).toBe(400); expect((await request(stack.server).post(path(p.id, 'cancel')).set('Idempotency-Key', randomUUID()).send({})).status).toBe(401);
    }, 120_000);
    it('V2-P4-30 package.cancelled cancela la parte de vuelo sin penalidad y es idempotente por id de evento', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, ALL_EVENTS); const p = await purchase(s); const id = `evt-bkp-${randomUUID()}`; const data = { packageId: 'PKG-UIO-GYE-0091', bookingId: p.id, reason: 'Falló la reserva del hotel' };
      const first = await sendEvent('ec.edu.epn.booking.paquetes.package.cancelled', data, id); expect(first.status).toBe(202); expect(first.body.outcome).toBe('CANCELLED'); expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('CANCELLED');
      const sent = (await deliveries(s.client)).find((e) => e.eventType === 'booking.cancelled'); expect(sent?.extra).toMatchObject({ reasonCode: 'SAGA_COMPENSATION', seatsReleased: 1 }); expect(sent?.data?.refundAmount).toBe(p.total);
      const replay = await sendEvent('ec.edu.epn.booking.paquetes.package.cancelled', data, id); expect(replay.status).toBe(202); expect(replay.body.outcome).toBe('CANCELLED'); expect(replay.headers['idempotent-replayed']).toBe('true');
      const other = await sendEvent('ec.edu.epn.booking.paquetes.package.cancelled', data); expect(other.body.outcome).toBe('ALREADY_CANCELLED');
    }, 150_000);
    it('V2-P4-31 package.cancelled sobre una reserva con pago pendiente la falla y libera el hold; sobre una desconocida responde 404', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '120.00' }); const p = await purchase(s, 'u1', { reference, confirm: false });
      const res = await sendEvent('ec.edu.epn.booking.paquetes.package.cancelled', { packageId: 'PKG-1', bookingId: p.id }); expect(res.body.outcome).toBe('FAILED_APPLIED'); expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('FAILED');
      expect((await sendEvent('ec.edu.epn.booking.paquetes.package.cancelled', { packageId: 'PKG-1', bookingId: randomUUID() })).status).toBe(404);
    }, 150_000);
  });

  describe('asientos', () => {
    const seatBody = (segmentId: string, seats: Array<[string, string]>) => ({ seats: seats.map(([passengerId, seatNumber]) => ({ passengerId, segmentId, seatNumber })) });
    const put = async (id: string, client: TestClient, body: object, user = 'u1', key: string | null = randomUUID()) => { let call = request(stack.server).put(path(id, 'seats')).set(await headers(stack, client, user)); if (key) call = call.set('Idempotency-Key', key); return call.send(body); };
    it('V2-P4-40 cambia el asiento de una reserva emitida: 200 SeatChangeResponse con el anterior, estado TICKETED, mapa actualizado y booking.seat_changed', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, ALL_EVENTS); const held = await hold(stack, s, s.client, 'u1'); const segmentId = held.offer.segmentId;
      const created = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1A' }] })] }); const id = created.response.body.bookingId;
      const res = await put(id, s.client, seatBody(segmentId, [['PAX-1', '1C']])); expect(res.status).toBe(200); expectV2Response('PUT', '/vuelos/bookings/{bookingId}/seats', 200, res.body);
      expect(res.body.seats).toEqual([{ passengerId: 'PAX-1', segmentId, previousSeatNumber: '1A', seatNumber: '1C', status: 'TICKETED' }]); expect(res.body.amountCharged).toBeUndefined();
      const map = await request(stack.server).get(`/api/v2/vuelos/offers/${held.offer.offerId}/seatmap`).query({ segmentId }); const seatOf = (n: string) => map.body.cabins[0].rows.flatMap((r: { seats: Array<{ seatNumber: string; status: string }> }) => r.seats).find((x: { seatNumber: string }) => x.seatNumber === n);
      expect([seatOf('1A').status, seatOf('1C').status]).toEqual(['AVAILABLE', 'BOOKED']);
      const sent = (await deliveries(s.client)).find((e) => e.eventType === 'booking.seat_changed'); expect(sent?.extra).toMatchObject({ changeType: 'SEAT' }); expectSchema('EventBookingChanged', buildCloudEvent(sent!, 'gabatair'));
      expect((await getBooking(stack, s.client, 'u1', id)).body.passengers[0].assignedSeats[0].seatNumber).toBe('1C');
    }, 150_000);
    it('V2-P4-41 un asiento ocupado por otra reserva responde 409 SEAT_TAKEN y nada cambia', async () => {
      const s = await scenario(); const a = await hold(stack, s, s.client, 'u1'); const b = await hold(stack, s, s.client, 'u2'); const segmentId = a.offer.segmentId;
      const pa = await book(stack, s, s.client, 'u1', a, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1A' }] })] }); await book(stack, s, s.client, 'u2', b, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1B' }] })] });
      const res = await put(pa.response.body.bookingId, s.client, seatBody(segmentId, [['PAX-1', '1B']])); expect(res.status).toBe(409); expect(res.body.code).toBe('SEAT_TAKEN'); expectV2Response('PUT', '/vuelos/bookings/{bookingId}/seats', 409, res.body);
      expect((await getBooking(stack, s.client, 'u1', pa.response.body.bookingId)).body.passengers[0].assignedSeats[0].seatNumber).toBe('1A');
    }, 180_000);
    it('V2-P4-42 el cambio es atómico: si un asiento falla no se cambia ninguno', async () => {
      const s = await scenario(); const a = await hold(stack, s, s.client, 'u1', {}, { adults: 2 }); const b = await hold(stack, s, s.client, 'u2'); const segmentId = a.offer.segmentId;
      const pa = await book(stack, s, s.client, 'u1', a, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1A' }] }), passenger('PAX-2', { documentNumber: 'OTHER9999', assignedSeats: [{ segmentId, seatNumber: '1B' }] })] }); await book(stack, s, s.client, 'u2', b, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1C' }] })] });
      const res = await put(pa.response.body.bookingId, s.client, seatBody(segmentId, [['PAX-1', '1A'], ['PAX-2', '1C']])); expect(res.status).toBe(409);
      const seats = (await getBooking(stack, s.client, 'u1', pa.response.body.bookingId)).body.passengers.map((p: { passengerId: string; assignedSeats: Array<{ seatNumber: string }> }) => [p.passengerId, p.assignedSeats[0].seatNumber]); expect(Object.fromEntries(seats)).toEqual({ 'PAX-1': '1A', 'PAX-2': '1B' });
    }, 240_000);
    it('V2-P4-43 dos pasajeros de la reserva pueden intercambiar asientos en una sola llamada', async () => {
      const s = await scenario(); const a = await hold(stack, s, s.client, 'u1', {}, { adults: 2 }); const segmentId = a.offer.segmentId;
      const pa = await book(stack, s, s.client, 'u1', a, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1A' }] }), passenger('PAX-2', { documentNumber: 'OTHER9999', assignedSeats: [{ segmentId, seatNumber: '1B' }] })] });
      const res = await put(pa.response.body.bookingId, s.client, seatBody(segmentId, [['PAX-1', '1B'], ['PAX-2', '1A']])); expect(res.status).toBe(200); expect(res.body.seats.map((x: { passengerId: string; seatNumber: string; previousSeatNumber: string }) => [x.passengerId, x.previousSeatNumber, x.seatNumber])).toEqual([['PAX-1', '1A', '1B'], ['PAX-2', '1B', '1A']]);
    }, 180_000);
    it('V2-P4-44 un asiento que no existe en el avión responde 422 SEAT_CABIN_MISMATCH y un infante 422 INFANT_SEAT_NOT_ALLOWED', async () => {
      const s = await scenario(); const a = await hold(stack, s, s.client, 'u1', {}, { adults: 1, infants: 1 }); const segmentId = a.offer.segmentId;
      const infant = passenger('PAX-2', { passengerType: 'INFANT', birthDate: '2026-01-01', documentNumber: 'BABY12345', associatedAdultId: 'PAX-1' }); const pa = await book(stack, s, s.client, 'u1', a, { passengers: [passenger('PAX-1'), infant] }); const id = pa.response.body.bookingId;
      const missing = await put(id, s.client, seatBody(segmentId, [['PAX-1', '9K']])); expect(missing.status).toBe(422); expect(missing.body.code).toBe('SEAT_CABIN_MISMATCH');
      const baby = await put(id, s.client, seatBody(segmentId, [['PAX-2', '1B']])); expect(baby.status).toBe(422); expect(baby.body.code).toBe('INFANT_SEAT_NOT_ALLOWED'); expectV2Response('PUT', '/vuelos/bookings/{bookingId}/seats', 422, baby.body);
    }, 150_000);
    it('V2-P4-45 después del check-in no se puede cambiar: 409 CUTOFF_PASSED', async () => {
      const s = await scenario({ hoursAhead: 36 }); const held = await hold(stack, s, s.client, 'u1'); const segmentId = held.offer.segmentId; const created = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1A' }] })] }); const id = created.response.body.bookingId;
      expect((await post(path(id, 'check-in'), s.client, undefined, 'u1', null)).status).toBe(200); const res = await put(id, s.client, seatBody(segmentId, [['PAX-1', '1B']])); expect(res.status).toBe(409); expect(res.body.code).toBe('CUTOFF_PASSED');
    }, 150_000);
    it('V2-P4-46 una reserva sin confirmar responde 409 BOOKING_NOT_CONFIRMED; un pasajero o segmento ajenos 400; otro usuario 404; cuerpo inválido 400', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const segmentId = held.offer.segmentId; const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '120.00' });
      const pending = await book(stack, s, s.client, 'u1', held, { reference, confirm: false }); expect((await put(pending.response.body.bookingId, s.client, seatBody(segmentId, [['PAX-1', '1B']]))).status).toBe(409);
      const t = await scenario(); const h2 = await hold(stack, t, t.client, 'u1'); const done = await book(stack, t, t.client, 'u1', h2); const id = done.response.body.bookingId; const seg = h2.offer.segmentId;
      expect((await put(id, t.client, seatBody(seg, [['PAX-9', '1B']]))).status).toBe(400); expect((await put(id, t.client, seatBody(randomUUID(), [['PAX-1', '1B']]))).status).toBe(400); expect((await put(id, t.client, seatBody(seg, [['PAX-1', '1B']]), 'u2')).status).toBe(404);
      for (const bad of [{ seats: [] }, {}, { seats: [{ passengerId: 'PAX-1', seatNumber: '1B' }] }]) expect((await put(id, t.client, bad)).status).toBe(400); expect((await put(id, t.client, seatBody(seg, [['PAX-1', '1B']]), 'u1', null)).status).toBe(400);
    }, 240_000);
    it('V2-P4-47 un reintento con la misma clave devuelve 200 Idempotent-Replayed y no cambia de nuevo', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const segmentId = held.offer.segmentId; const created = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1A' }] })] }); const id = created.response.body.bookingId; const key = randomUUID(); const body = seatBody(segmentId, [['PAX-1', '1B']]);
      const first = await put(id, s.client, body, 'u1', key); const replay = await put(id, s.client, body, 'u1', key); expect([first.status, replay.status]).toEqual([200, 200]); expect(replay.headers['idempotent-replayed']).toBe('true'); expect(replay.body).toEqual(first.body);
    }, 150_000);
  });

  describe('check-in y pases de abordar', () => {
    it('V2-P4-50 hace el check-in dentro de la ventana de 48 h: 200 CheckInResponse con el id de Booking, enlaces y booking.checked_in; luego los pases', async () => {
      const s = await scenario({ hoursAhead: 36 }); await stack.subscribe(s.client.clientId, ALL_EVENTS); const held = await hold(stack, s, s.client, 'u1'); const segmentId = held.offer.segmentId;
      const created = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId, seatNumber: '1A' }] })] }); const id = created.response.body.bookingId;
      const res = await post(path(id, 'check-in'), s.client, undefined, 'u1', null); expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/bookings/{bookingId}/check-in', 200, res.body); expect(res.body.checkedInPassengers[0]).toMatchObject({ passengerId: 'PAX-1', status: 'CHECKED_IN' }); expect(res.body._links.self.method).toBe('GET');
      const passes = await get(path(id, 'boarding-passes'), s.client); expect(passes.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}/boarding-passes', 200, passes.body); expect(passes.body.boardingPasses[0]).toMatchObject({ passengerId: 'PAX-1', segmentId, seat: '1A' });
      expect((await events(s.client)).map((e) => e.type)).toContain('booking.checked_in');
    }, 150_000);
    it('V2-P4-51 fuera de la ventana responde 409 CHECK_IN_NOT_AVAILABLE y los pases antes del check-in 409 BOARDING_PASS_NOT_AVAILABLE', async () => {
      const s = await scenario(); const p = await purchase(s); const res = await post(path(p.id, 'check-in'), s.client, undefined, 'u1', null); expect(res.status).toBe(409); expect(res.body.code).toBe('CHECK_IN_NOT_AVAILABLE'); expectV2Response('POST', '/vuelos/bookings/{bookingId}/check-in', 409, res.body);
      const passes = await get(path(p.id, 'boarding-passes'), s.client); expect(passes.status).toBe(409); expect(passes.body.code).toBe('BOARDING_PASS_NOT_AVAILABLE'); expectV2Response('GET', '/vuelos/bookings/{bookingId}/boarding-passes', 409, passes.body);
    }, 120_000);
    it('V2-P4-52 repetir el check-in no se duplica; otro usuario 404; sin token 401; sin scope 403', async () => {
      const s = await scenario({ hoursAhead: 36 }); const held = await hold(stack, s, s.client, 'u1'); const created = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId: held.offer.segmentId, seatNumber: '1A' }] })] }); const id = created.response.body.bookingId;
      expect((await post(path(id, 'check-in'), s.client, undefined, 'u1', null)).status).toBe(200); const again = await post(path(id, 'check-in'), s.client, undefined, 'u1', null); expect([200, 409]).toContain(again.status);
      expect(await stack.db.operations.checkIn.count({ where: { bookingId: id } })).toBe(1); expect((await post(path(id, 'check-in'), s.client, undefined, 'u2', null)).status).toBe(404); expect((await request(stack.server).post(path(id, 'check-in'))).status).toBe(401);
      const reader = await stack.newClient(['flights:read']); expect((await post(path(id, 'check-in'), reader, undefined, 'u1', null)).status).toBe(403); expect((await get(path(id, 'boarding-passes'), s.client, 'u2')).status).toBe(404);
    }, 150_000);
  });
});
