import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { GrpcTicketingGateway } from '../../../../../microservices/reservation-service/src/infrastructure/clients/grpc-gateways';
import { buildCloudEvent, type WebhookPayload } from '../../../../../microservices/webhooks-service/src/domain/webhook';
import { expectSchema, expectV2Response, type TestClient } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, getBooking, headers, hold, newReference, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const BOOKING_EVENTS = ['booking.confirmed', 'booking.ticket_issued', 'booking.ticket_failed', 'booking.failed'];

describeReal('F12a P2 · reservas, emisión y boletos v2 (contra servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  const scenario = async (options: Parameters<Stack['scenario']>[0] = {}) => { const value = await stack.scenario(options); scenarios.push(value); return value; };
  beforeAll(async () => { stack = await startStack(); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);
  const reservations = (client: TestClient) => stack.db.reservation.reservation.findMany({ where: { ownerId: { startsWith: client.clientId } } });
  const deliveries = async (client: TestClient) => (await stack.db.webhooks.delivery.findMany({ where: { subscription: { ownerId: client.clientId } }, orderBy: { id: 'asc' } })).map((row) => row.payload as unknown as WebhookPayload);
  const get = async (path: string, client: TestClient, user?: string) => request(stack.server).get(path).set(await headers(stack, client, user));
  const confirmed = async (s: Scenario, user = 'u1', options: Parameters<typeof book>[5] = {}, held?: Awaited<ReturnType<typeof hold>>) => { const h = held ?? await hold(stack, s, s.client, user); const result = await book(stack, s, s.client, user, h, options); return { held: h, ...result }; };

  describe('POST /vuelos/bookings', () => {
    it('V2-P2-35 con el pago confirmado crea la reserva: 201, BookingDetail, boletos emitidos y datos de v2', async () => {
      const s = await scenario(); const salesChannel = { partnerId: 'BOOKING_PROTOTIPO', partnerOrderId: 'ORD-BKP-55120', packageId: null, promotionApplied: false };
      const { response, reference, held } = await confirmed(s, 'u1', { body: { salesChannel } });
      expect(response.status).toBe(201); expectV2Response('POST', '/vuelos/bookings', 201, response.body);
      expect(response.body).toMatchObject({ status: 'CONFIRMED', holdId: held.holdId, paymentReference: reference, salesChannel });
      expect(response.headers.location).toBe(`http://gateway.test/api/v2/vuelos/bookings/${response.body.bookingId}`);
      expect(response.body.passengers[0].passengerId).toBe('PAX-1'); expect(response.body.tickets).toHaveLength(1);
      expect(response.body.tickets[0]).toMatchObject({ status: 'ISSUED', passengerId: 'PAX-1', passengerName: 'Maria Andrade', bookingId: response.body.bookingId });
      expect(response.body._links['check-in']).toBeDefined(); expect(response.body._links.seats.method).toBe('PUT');
      expect(stack.payments.requests).toContain(reference); expect(stack.payments.authSeen.at(-1)).toBe('Bearer simulator-credential');
      expect(JSON.stringify(response.body)).not.toContain('flightInstanceId');
    }, 90_000);
    it('V2-P2-36 publica booking.confirmed y booking.ticket_issued como CloudEvents válidos solo al cliente dueño', async () => {
      const s = await scenario(); const other = await s.extraClient(); await stack.subscribe(s.client.clientId, BOOKING_EVENTS); await stack.subscribe(other.clientId, BOOKING_EVENTS);
      const { response, reference } = await confirmed(s); expect(response.status).toBe(201);
      const events = (await deliveries(s.client)).filter((p) => p.data?.bookingId === response.body.bookingId); expect(events.map((e) => e.eventType).sort()).toEqual(['booking.confirmed', 'booking.ticket_issued']);
      const cloud = events.map((e) => buildCloudEvent(e, 'gabatair') as Record<string, unknown> & { type: string; id: string; data: Record<string, unknown> & { tickets: unknown[] } }); const issued = cloud.find((e) => e.type.endsWith('ticket_issued'))!; const done = cloud.find((e) => e.type.endsWith('booking.confirmed'))!;
      expectSchema('EventTicketIssued', issued); expectSchema('EventBookingConfirmed', done);
      expect(issued.data).toMatchObject({ bookingId: response.body.bookingId, status: 'CONFIRMED', paymentReference: reference, ownerId: 'u1', grandTotal: { currency: 'USD', total: '120.00' } }); expect(issued.data.tickets).toHaveLength(1);
      expect(issued.id).not.toBe(done.id); expect(await deliveries(other)).toHaveLength(0);
    }, 90_000);
    it('V2-P2-37 un reintento con la misma Idempotency-Key devuelve 200, Idempotent-Replayed y la misma reserva sin volver a consultar el pago', async () => {
      const s = await scenario(); const first = await confirmed(s); const key = first.key; const calls = stack.payments.requests.length;
      const again = await request(stack.server).post('/api/v2/vuelos/bookings').set(await headers(stack, s.client, 'u1')).set('Idempotency-Key', key).send(first.body);
      expect(first.response.status).toBe(201); expect(again.status).toBe(200); expect(again.headers['idempotent-replayed']).toBe('true'); expect(again.body.bookingId).toBe(first.response.body.bookingId); expectV2Response('POST', '/vuelos/bookings', 200, again.body);
      expect(await reservations(s.client)).toHaveLength(1); expect(stack.payments.requests.length).toBe(calls);
    }, 90_000);
    it('V2-P2-38 la misma clave con otro cuerpo responde 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const s = await scenario(); const first = await confirmed(s);
      const res = await request(stack.server).post('/api/v2/vuelos/bookings').set(await headers(stack, s.client, 'u1')).set('Idempotency-Key', first.key).send({ ...first.body, passengers: [passenger('PAX-1', { firstName: 'Otra' })] });
      expect(res.status).toBe(409); expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED'); expectV2Response('POST', '/vuelos/bookings', 409, res.body);
    }, 90_000);
    it('V2-P2-39 con el pago pendiente responde 202 PENDING_PAYMENT y el scheduler lo confirma al aprobarse', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, BOOKING_EVENTS); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '120.00', moneda: 'USD' });
      const { response } = await confirmed(s, 'u1', { reference, confirm: false }); expect(response.status).toBe(202); expectV2Response('POST', '/vuelos/bookings', 202, response.body);
      expect(response.body).toMatchObject({ status: 'PENDING_PAYMENT', tickets: [] }); expect(response.body._links['issue-tickets'].method).toBe('POST');
      await stack.scheduler.run('resume-pending'); expect((await getBooking(stack, s.client, 'u1', response.body.bookingId)).body.status).toBe('PENDING_PAYMENT');
      stack.payments.confirmed(reference, '120.00'); await stack.scheduler.run('resume-pending');
      const final = await getBooking(stack, s.client, 'u1', response.body.bookingId); expect(final.body.status).toBe('CONFIRMED'); expect(final.body.tickets[0].status).toBe('ISSUED'); expectV2Response('GET', '/vuelos/bookings/{bookingId}', 200, final.body);
      expect((await deliveries(s.client)).map((e) => e.eventType).sort()).toEqual(['booking.confirmed', 'booking.ticket_issued']);
    }, 120_000);
    it('V2-P2-40 con el pago pendiente POST /tickets responde 422 y, ya confirmado, emite con issued 1', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDING', monto: '120.00' });
      const { response } = await confirmed(s, 'u1', { reference, confirm: false }); const id = response.body.bookingId; const h = await headers(stack, s.client, 'u1');
      const blocked = await request(stack.server).post(`/api/v2/vuelos/bookings/${id}/tickets`).set(h); expect(blocked.status).toBe(422); expect(blocked.body.code).toBe('PAYMENT_NOT_AUTHORIZED'); expectV2Response('POST', '/vuelos/bookings/{bookingId}/tickets', 422, blocked.body);
      stack.payments.confirmed(reference, '120.00'); const issued = await request(stack.server).post(`/api/v2/vuelos/bookings/${id}/tickets`).set(h);
      expect(issued.status).toBe(200); expectV2Response('POST', '/vuelos/bookings/{bookingId}/tickets', 200, issued.body); expect(issued.body).toMatchObject({ status: 'CONFIRMED', issued: 1, bookingId: id });
    }, 120_000);
    it('V2-P2-41 un pago fallido responde 422 PAYMENT_NOT_AUTHORIZED sin crear reserva y deja el hold vivo', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'FALLIDO' }); const held = await hold(stack, s, s.client, 'u1');
      const { response } = await book(stack, s, s.client, 'u1', held, { reference, confirm: false });
      expect(response.status).toBe(422); expect(response.body.code).toBe('PAYMENT_NOT_AUTHORIZED'); expectV2Response('POST', '/vuelos/bookings', 422, response.body);
      expect(await reservations(s.client)).toHaveLength(0); expect((await get(`/api/v2/vuelos/offers/hold/${held.holdId}`, s.client, 'u1')).body.status).toBe('HELD');
    }, 90_000);
    it('V2-P2-42 una referencia que Booking no conoce responde 422 PAYMENT_NOT_AUTHORIZED', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const { response } = await book(stack, s, s.client, 'u1', held, { reference: newReference(), confirm: false });
      expect(response.status).toBe(422); expect(response.body.code).toBe('PAYMENT_NOT_AUTHORIZED'); expect(await reservations(s.client)).toHaveLength(0);
    }, 90_000);
    it('V2-P2-43 un monto distinto en la API de pagos responde 422 AMOUNT_MISMATCH sin crear reserva', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'CONFIRMADO', monto: '99.99', moneda: 'USD' }); const held = await hold(stack, s, s.client, 'u1');
      const { response } = await book(stack, s, s.client, 'u1', held, { reference, confirm: false });
      expect(response.status).toBe(422); expect(response.body.code).toBe('AMOUNT_MISMATCH'); expect(await reservations(s.client)).toHaveLength(0);
    }, 90_000);
    it('V2-P2-44 un payment.amount distinto del precio congelado responde 422 AMOUNT_MISMATCH sin consultar el pago', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const reference = newReference(); stack.payments.confirmed(reference, '120.00');
      const { response } = await book(stack, s, s.client, 'u1', held, { reference, confirm: false, body: { payment: { paymentReference: reference, amount: { currency: 'USD', total: '1.00' } } } });
      expect(response.status).toBe(422); expect(response.body.code).toBe('AMOUNT_MISMATCH'); expect(stack.payments.requests).not.toContain(reference);
    }, 90_000);
    it('V2-P2-45 con la API de pagos caída responde 503 PROVIDER_UNAVAILABLE con Retry-After y el mismo reintento funciona al volver', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const reference = newReference(); stack.payments.confirmed(reference, '120.00'); stack.payments.down = true;
      let first; try { first = await book(stack, s, s.client, 'u1', held, { reference, confirm: false }); } finally { stack.payments.down = false; }
      expect(first.response.status).toBe(503); expect(first.response.body.code).toBe('PROVIDER_UNAVAILABLE'); expect(first.response.headers['retry-after']).toBeDefined(); expectV2Response('POST', '/vuelos/bookings', 503, first.response.body); expect(await reservations(s.client)).toHaveLength(0);
      const retry = await book(stack, s, s.client, 'u1', held, { reference, confirm: false, key: first.key }); expect(retry.response.status).toBe(201);
    }, 90_000);
    it('V2-P2-46 sin respuesta dentro del plazo propio responde 503 y no crea reserva', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const reference = newReference(); stack.payments.set(reference, { estado: 'CONFIRMADO', monto: '120.00', delayMs: 4000 });
      const started = Date.now(); const { response } = await book(stack, s, s.client, 'u1', held, { reference, confirm: false });
      expect(response.status).toBe(503); expect(Date.now() - started).toBeLessThan(4000); expect(await reservations(s.client)).toHaveLength(0);
    }, 90_000);
    it('V2-P2-47 una referencia ya usada en otra reserva responde 422 PAYMENT_REFERENCE_INVALID', async () => {
      const s = await scenario(); const first = await confirmed(s, 'u1'); expect(first.response.status).toBe(201);
      const second = await hold(stack, s, s.client, 'u1'); const { response } = await book(stack, s, s.client, 'u1', second, { reference: first.reference });
      expect(response.status).toBe(422); expect(response.body.code).toBe('PAYMENT_REFERENCE_INVALID');
    }, 120_000);
    it('V2-P2-48 la referencia es cualquier texto de 1 a 64 caracteres, sin patrón', async () => {
      const s = await scenario(); const reference = 'pago #1/ñ ?x=1 '.padEnd(64, 'z'); expect(reference).toHaveLength(64);
      const { response } = await confirmed(s, 'u1', { reference }); expect(response.status).toBe(201); expect(response.body.paymentReference).toBe(reference);
      const long = await hold(stack, s, s.client, 'u1'); const tooLong = await book(stack, s, s.client, 'u1', long, { reference: 'x'.repeat(65), confirm: false }); expect(tooLong.response.status).toBe(400);
      const empty = await book(stack, s, s.client, 'u1', long, { reference: '', confirm: false }); expect(empty.response.status).toBe(400);
    }, 120_000);
    it('V2-P2-49 el hold de otro usuario o de otro cliente responde 404', async () => {
      const s = await scenario(); const other = await s.extraClient(); const held = await hold(stack, s, s.client, 'u1');
      const sameClient = await book(stack, s, s.client, 'u1', held, { user: 'u2' }); expect(sameClient.response.status).toBe(404); expectV2Response('POST', '/vuelos/bookings', 404, sameClient.response.body);
      const otherClient = await book(stack, s, s.client, 'u1', held, { client: other }); expect(otherClient.response.status).toBe(404);
    }, 90_000);
    it('V2-P2-50 un hold vencido responde 410 HOLD_EXPIRED', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); await stack.db.inventory.hold.update({ where: { id: held.holdId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const { response } = await book(stack, s, s.client, 'u1', held); expect(response.status).toBe(410); expect(response.body.code).toBe('HOLD_EXPIRED'); expectV2Response('POST', '/vuelos/bookings', 410, response.body);
    }, 90_000);
    it('V2-P2-51 un hold liberado responde 410 HOLD_EXPIRED', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, s.client, 'u1'));
      const { response } = await book(stack, s, s.client, 'u1', held); expect(response.status).toBe(410); expect(response.body.code).toBe('HOLD_EXPIRED');
    }, 90_000);
    it('V2-P2-52 un hold ya consumido por otra reserva responde 409 HOLD_ALREADY_CONSUMED', async () => {
      const s = await scenario(); const first = await confirmed(s); expect(first.response.status).toBe(201);
      const { response } = await book(stack, s, s.client, 'u1', first.held); expect(response.status).toBe(409); expect(response.body.code).toBe('HOLD_ALREADY_CONSUMED'); expectV2Response('POST', '/vuelos/bookings', 409, response.body);
    }, 90_000);
    it('V2-P2-53 pasajeros que no coinciden con el desglose del hold responden 422 PASSENGER_COUNT_MISMATCH', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1');
      const { response } = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1'), passenger('PAX-2', { documentNumber: 'OTHER9999' })] });
      expect(response.status).toBe(422); expect(response.body.code).toBe('PASSENGER_COUNT_MISMATCH'); expect(await reservations(s.client)).toHaveLength(0);
    }, 90_000);
    it('V2-P2-54 un infante sin adulto asociado válido responde 422 INFANT_WITHOUT_ADULT', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1', {}, { adults: 1, infants: 1 }); const infant = (extra: Record<string, unknown>) => passenger('PAX-2', { passengerType: 'INFANT', birthDate: '2026-01-01', documentNumber: 'BABY12345', ...extra });
      for (const extra of [{}, { associatedAdultId: 'PAX-9' }, { associatedAdultId: 'PAX-2' }]) { const { response } = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1'), infant(extra)] }); expect({ extra, status: response.status, code: response.body.code }).toEqual({ extra, status: 422, code: 'INFANT_WITHOUT_ADULT' }); }
    }, 120_000);
    it('V2-P2-55 un infante con asiento responde 422 INFANT_SEAT_NOT_ALLOWED y con adulto y sin asiento se acepta', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1', {}, { adults: 1, infants: 1 }); const segmentId = held.offer.segmentId;
      const infant = (extra: Record<string, unknown>) => passenger('PAX-2', { passengerType: 'INFANT', birthDate: '2026-01-01', documentNumber: 'BABY12345', associatedAdultId: 'PAX-1', ...extra });
      const seated = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1'), infant({ assignedSeats: [{ segmentId, seatNumber: '1B' }] })] }); expect(seated.response.status).toBe(422); expect(seated.response.body.code).toBe('INFANT_SEAT_NOT_ALLOWED');
      const ok = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1'), infant({})] }); expect(ok.response.status).toBe(201); expect(ok.response.body.passengers.map((p: { passengerId: string }) => p.passengerId).sort()).toEqual(['PAX-1', 'PAX-2']);
      expect(ok.response.body.passengers.find((p: { passengerId: string }) => p.passengerId === 'PAX-2').associatedAdultId).toBe('PAX-1');
    }, 120_000);
    it('V2-P2-56 en un vuelo internacional solo se acepta pasaporte; en uno nacional basta el documento de identidad', async () => {
      const international = await scenario(); const domestic = await scenario({ domestic: true }); const id = { documentType: 'NATIONAL_ID', documentNumber: 'CEDULA1234', documentExpiryDate: undefined };
      const heldI = await hold(stack, international, international.client, 'u1'); const refused = await book(stack, international, international.client, 'u1', heldI, { passengers: [passenger('PAX-1', id)] });
      expect(refused.response.status).toBe(422); expect(refused.response.body.code).toBe('PASSPORT_REQUIRED_INTERNATIONAL');
      const heldD = await hold(stack, domestic, domestic.client, 'u1'); const accepted = await book(stack, domestic, domestic.client, 'u1', heldD, { passengers: [passenger('PAX-1', id)] }); expect(accepted.response.status).toBe(201);
    }, 120_000);
    it('V2-P2-57 un documento que vence antes del viaje responde 422 DOCUMENT_EXPIRED', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const { response } = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', { documentExpiryDate: '2020-01-01' })] });
      expect(response.status).toBe(422); expect(response.body.code).toBe('DOCUMENT_EXPIRED'); expect(await reservations(s.client)).toHaveLength(0);
    }, 90_000);
    it('V2-P2-58 passengerId repetido responde 400 y un id que ya es UUID se conserva', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1', {}, { adults: 2 });
      const duplicate = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1'), passenger('PAX-1', { documentNumber: 'OTHER9999' })] }); expect(duplicate.response.status).toBe(400);
      const id = randomUUID(); const ok = await book(stack, s, s.client, 'u1', held, { passengers: [passenger(id), passenger('PAX-2', { documentNumber: 'OTHER9999' })] });
      expect(ok.response.status).toBe(201); expect(ok.response.body.passengers.map((p: { passengerId: string }) => p.passengerId).sort()).toEqual([id, 'PAX-2'].sort());
    }, 120_000);
    it('V2-P2-59 sin token 401, scope insuficiente 403 y cuerpo inválido 400 con invalidParams', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const body = { holdId: held.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: newReference() } };
      const anonymous = await request(stack.server).post('/api/v2/vuelos/bookings').set('Idempotency-Key', randomUUID()).send(body); expect(anonymous.status).toBe(401); expect(anonymous.body.code).toBe('UNAUTHORIZED');
      const reader = await stack.newClient(['flights:read']); const forbidden = await request(stack.server).post('/api/v2/vuelos/bookings').set(await headers(stack, reader, 'u1')).set('Idempotency-Key', randomUUID()).send(body); expect(forbidden.status).toBe(403);
      const invalid = await request(stack.server).post('/api/v2/vuelos/bookings').set(await headers(stack, s.client, 'u1')).set('Idempotency-Key', randomUUID()).send({ holdId: 'nope', passengers: [], payment: {} }); expect(invalid.status).toBe(400); expect(invalid.body.invalidParams.length).toBeGreaterThan(0); expectV2Response('POST', '/vuelos/bookings', 400, invalid.body);
      const extra = await request(stack.server).post('/api/v2/vuelos/bookings').set(await headers(stack, s.client, 'u1')).set('Idempotency-Key', randomUUID()).send({ ...body, unexpected: true }); expect(extra.status).toBe(400);
    }, 90_000);
    it('V2-P2-60 un asiento ya tomado responde 409 SEAT_TAKEN', async () => {
      const s = await scenario(); const seat = (segmentId: string) => ({ assignedSeats: [{ segmentId, seatNumber: '1A' }] });
      const first = await hold(stack, s, s.client, 'u1'); expect((await book(stack, s, s.client, 'u1', first, { passengers: [passenger('PAX-1', seat(first.offer.segmentId))] })).response.status).toBe(201);
      const second = await hold(stack, s, s.client, 'u2'); const { response } = await book(stack, s, s.client, 'u2', second, { passengers: [passenger('PAX-1', seat(second.offer.segmentId))] });
      expect(response.status).toBe(409); expect(response.body.code).toBe('SEAT_TAKEN'); expectV2Response('POST', '/vuelos/bookings', 409, response.body);
    }, 120_000);
    it('V2-P2-61 el equipaje extra suma al total y el pago debe cubrirlo', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const extra = { extraBaggage: [{ itineraryId: held.offer.itineraryId, quantity: 1 }] };
      const short = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', extra)] }); expect(short.response.status).toBe(422); expect(short.response.body.code).toBe('AMOUNT_MISMATCH');
      const reference = newReference(); stack.payments.confirmed(reference, '170.00'); const ok = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', extra)], reference, confirm: false });
      expect(ok.response.status).toBe(201); expect(ok.response.body.grandTotal.total).toBe('170.00');
    }, 120_000);
    it('V2-P2-62 sin X-User-Id la huella del dispositivo identifica al usuario anónimo', async () => {
      const s = await scenario(); const fp = { 'X-Device-Fingerprint': `fp-${randomUUID()}` }; const base = await headers(stack, s.client);
      const offer = await s.search(); const created = await request(stack.server).post('/api/v2/vuelos/offers/hold').set(base).set(fp).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 } });
      expect(created.status).toBe(201); expect((await request(stack.server).get(`/api/v2/vuelos/offers/hold/${created.body.holdId}`).set(base).set(fp)).status).toBe(200);
      expect((await request(stack.server).get(`/api/v2/vuelos/offers/hold/${created.body.holdId}`).set(base).set({ 'X-Device-Fingerprint': 'otra-huella' })).status).toBe(404);
    }, 90_000);
  });

  describe('GET /vuelos/bookings', () => {
    it('V2-P2-63 lista solo las reservas del usuario, cumple BookingListResponse y trae enlaces', async () => {
      const s = await scenario(); const other = await s.extraClient(); const { response } = await confirmed(s, 'u1');
      const mine = await get('/api/v2/vuelos/bookings', s.client, 'u1'); expect(mine.status).toBe(200); expectV2Response('GET', '/vuelos/bookings', 200, mine.body);
      expect(mine.body.items.map((i: { bookingId: string }) => i.bookingId)).toEqual([response.body.bookingId]); expect(mine.body.items[0]).toMatchObject({ status: 'CONFIRMED', origin: s.origin, destination: s.destination, departureDate: s.date }); expect(mine.body.items[0]._links.self.method).toBe('GET');
      expect((await get('/api/v2/vuelos/bookings', s.client, 'u2')).body.items).toEqual([]); expect((await get('/api/v2/vuelos/bookings', other, 'u1')).body.items).toEqual([]);
    }, 90_000);
    it('V2-P2-64 filtra por estado, pnr y fechas de creación', async () => {
      const s = await scenario(); const { response } = await confirmed(s, 'u1'); const pnr = response.body.pnr; const today = new Date().toISOString().slice(0, 10); const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10); const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const ids = async (query: Record<string, string>) => (await request(stack.server).get('/api/v2/vuelos/bookings').query(query).set(await headers(stack, s.client, 'u1'))).body.items.map((i: { bookingId: string }) => i.bookingId);
      expect(await ids({ status: 'CONFIRMED' })).toHaveLength(1); expect(await ids({ status: 'FAILED' })).toEqual([]); expect(await ids({ pnr })).toHaveLength(1); expect(await ids({ pnr: 'ZZZZZZ' })).toEqual([]);
      expect(await ids({ createdFrom: today })).toHaveLength(1); expect(await ids({ createdFrom: tomorrow })).toEqual([]); expect(await ids({ createdTo: yesterday })).toEqual([]); expect(await ids({ createdFrom: yesterday, createdTo: tomorrow })).toHaveLength(1);
    }, 90_000);
    it('V2-P2-65 pagina con limit y cursor sin repetir ni omitir', async () => {
      const s = await scenario(); const created = []; for (let i = 0; i < 2; i += 1) created.push((await confirmed(s, 'u1')).response.body.bookingId);
      const seen: string[] = []; let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) { const res = await request(stack.server).get('/api/v2/vuelos/bookings').query({ limit: '1', ...(cursor ? { cursor } : {}) }).set(await headers(stack, s.client, 'u1')); expect(res.status).toBe(200); seen.push(...res.body.items.map((i: { bookingId: string }) => i.bookingId)); cursor = res.body.nextCursor ?? undefined; if (!cursor) break; }
      expect(seen.sort()).toEqual([...created].sort());
    }, 180_000);
    it('V2-P2-66 un estado desconocido o un limit fuera de rango responden 400 y sin token 401', async () => {
      const s = await scenario(); const h = await headers(stack, s.client, 'u1');
      for (const query of [{ status: 'NOPE' }, { limit: '0' }, { limit: '51' }, { createdFrom: 'ayer' }]) expect({ query, status: (await request(stack.server).get('/api/v2/vuelos/bookings').query(query).set(h)).status }).toEqual({ query, status: 400 });
      expect((await request(stack.server).get('/api/v2/vuelos/bookings')).status).toBe(401);
    });
  });

  describe('GET /vuelos/bookings/{bookingId} y boletos', () => {
    it('V2-P2-67 el detalle cumple BookingDetail; otro usuario u otro cliente reciben 404; id inválido 400', async () => {
      const s = await scenario(); const other = await s.extraClient(); const { response } = await confirmed(s, 'u1'); const id = response.body.bookingId;
      const detail = await get(`/api/v2/vuelos/bookings/${id}`, s.client, 'u1'); expect(detail.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}', 200, detail.body); expect(detail.body.holdId).toBe(response.body.holdId);
      for (const [client, user] of [[s.client, 'u2'], [other, 'u1']] as const) { const res = await get(`/api/v2/vuelos/bookings/${id}`, client, user); expect(res.status).toBe(404); expectV2Response('GET', '/vuelos/bookings/{bookingId}', 404, res.body); }
      expect((await get('/api/v2/vuelos/bookings/nope', s.client, 'u1')).status).toBe(400); expect((await request(stack.server).get(`/api/v2/vuelos/bookings/${id}`)).status).toBe(401);
    }, 90_000);
    it('V2-P2-68 lista los boletos con nombre del pasajero, vuelo y asiento y devuelve uno por id', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const { response } = await book(stack, s, s.client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId: held.offer.segmentId, seatNumber: '1C' }] })] }); const id = response.body.bookingId;
      const list = await get(`/api/v2/vuelos/bookings/${id}/tickets`, s.client, 'u1'); expect(list.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}/tickets', 200, list.body);
      expect(list.body.tickets[0]).toMatchObject({ passengerId: 'PAX-1', passengerName: 'Maria Andrade', status: 'ISSUED' }); expect(list.body.tickets[0].segments[0]).toMatchObject({ flightNumber: s.flightNumber, departureIataCode: s.origin, arrivalIataCode: s.destination, seatNumber: '1C' });
      const one = await get(`/api/v2/vuelos/bookings/${id}/tickets/${list.body.tickets[0].ticketId}`, s.client, 'u1'); expect(one.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}/tickets/{ticketId}', 200, one.body); expect(one.body.ticketId).toBe(list.body.tickets[0].ticketId);
    }, 90_000);
    it('V2-P2-69 un boleto inexistente o de otro usuario responde 404', async () => {
      const s = await scenario(); const { response } = await confirmed(s, 'u1'); const id = response.body.bookingId; const ticketId = response.body.tickets[0].ticketId;
      expect((await get(`/api/v2/vuelos/bookings/${id}/tickets/TKT-NOEXISTE1`, s.client, 'u1')).status).toBe(404); expect((await get(`/api/v2/vuelos/bookings/${id}/tickets/${ticketId}`, s.client, 'u2')).status).toBe(404); expect((await get(`/api/v2/vuelos/bookings/${id}/tickets`, s.client, 'u2')).status).toBe(404);
    }, 90_000);
    it('V2-P2-70 POST /tickets sobre una reserva ya emitida es idempotente: 200, issued 0 y sin eventos nuevos', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, BOOKING_EVENTS); const { response } = await confirmed(s, 'u1'); const before = (await deliveries(s.client)).length;
      const res = await request(stack.server).post(`/api/v2/vuelos/bookings/${response.body.bookingId}/tickets`).set(await headers(stack, s.client, 'u1'));
      expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/bookings/{bookingId}/tickets', 200, res.body); expect(res.body).toMatchObject({ status: 'CONFIRMED', issued: 0 }); expect(res.body.tickets).toHaveLength(1); expect((await deliveries(s.client)).length).toBe(before);
    }, 90_000);
    it('V2-P2-71 POST /tickets sobre una reserva fallida responde 409 BOOKING_NOT_CONFIRMED y de otro usuario 404', async () => {
      const s = await scenario(); const { response } = await confirmed(s, 'u1'); const id = response.body.bookingId; const h = await headers(stack, s.client, 'u1');
      expect((await request(stack.server).post(`/api/v2/vuelos/bookings/${id}/tickets`).set(await headers(stack, s.client, 'u2'))).status).toBe(404);
      await stack.db.reservation.reservation.update({ where: { id }, data: { status: 'FAILED' } }); const res = await request(stack.server).post(`/api/v2/vuelos/bookings/${id}/tickets`).set(h);
      expect(res.status).toBe(409); expect(res.body.code).toBe('BOOKING_NOT_CONFIRMED'); expectV2Response('POST', '/vuelos/bookings/{bookingId}/tickets', 409, res.body);
    }, 90_000);
  });

  describe('emisión diferida (Ticketing no disponible)', () => {
    it('V2-P2-72 si Ticketing falla responde 202 TICKET_ISSUING con el bookingId y POST /tickets completa la emisión', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, BOOKING_EVENTS); const spy = jest.spyOn(GrpcTicketingGateway.prototype, 'issueTickets').mockRejectedValueOnce(new Error('ticketing down'));
      try {
        const { response } = await confirmed(s, 'u1'); expect(response.status).toBe(202); expectV2Response('POST', '/vuelos/bookings', 202, response.body); expect(response.body).toMatchObject({ status: 'TICKET_ISSUING', tickets: [] });
        expect((await deliveries(s.client))).toHaveLength(0);
        const issued = await request(stack.server).post(`/api/v2/vuelos/bookings/${response.body.bookingId}/tickets`).set(await headers(stack, s.client, 'u1'));
        expect(issued.status).toBe(200); expect(issued.body).toMatchObject({ status: 'CONFIRMED', issued: 1 }); expect((await deliveries(s.client)).map((e) => e.eventType).sort()).toEqual(['booking.confirmed', 'booking.ticket_issued']);
      } finally { spy.mockRestore(); }
    }, 120_000);
    it('V2-P2-73 tras tres fallos la reserva queda FAILED y se publican booking.ticket_failed y booking.failed', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, BOOKING_EVENTS); const spy = jest.spyOn(GrpcTicketingGateway.prototype, 'issueTickets').mockRejectedValue(new Error('ticketing down'));
      try {
        const { response } = await confirmed(s, 'u1'); expect(response.status).toBe(202);
        for (let i = 0; i < 3; i += 1) await stack.scheduler.run('resume-pending');
        const detail = await getBooking(stack, s.client, 'u1', response.body.bookingId); expect(detail.body.status).toBe('FAILED');
        const events = await deliveries(s.client); expect(events.map((e) => e.eventType).sort()).toEqual(['booking.failed', 'booking.ticket_failed']);
        expectSchema('EventBookingFailed', buildCloudEvent(events.find((e) => e.eventType === 'booking.failed')!, 'gabatair'));
        expect(await stack.db.inventory.cabinInventory.findFirst({ where: { flightInstanceId: s.flightId }, select: { held: true, sold: true } })).toEqual({ held: 0, sold: 0 });
      } finally { spy.mockRestore(); }
    }, 180_000);
  });
});
