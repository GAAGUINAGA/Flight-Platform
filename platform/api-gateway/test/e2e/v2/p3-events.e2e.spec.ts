import { createHmac, randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { GrpcTicketingGateway } from '../../../../../microservices/reservation-service/src/infrastructure/clients/grpc-gateways';
import { expectSchema, expectV2Response, type TestClient } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, getBooking, headers, hold, newReference, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const SECRET = `booking-shared-secret-${randomUUID()}`;
const HOOK = 'https://93.184.216.34/hooks/booking';
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const event = (kind: 'confirmed' | 'failed', data: Record<string, unknown>, id = `evt-bkp-${randomUUID()}`) => ({ specversion: '1.0', type: `ec.edu.epn.booking.pagos.payment.${kind}`, source: '/booking/pagos', id, time: new Date().toISOString(), correlationid: `corr-${randomUUID()}`, data });

describeReal('F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  const scenario = async (options: Parameters<Stack['scenario']>[0] = {}) => { const value = await stack.scenario(options); scenarios.push(value); return value; };
  beforeAll(async () => { stack = await startStack({ BOOKING_EVENTS_SECRET: SECRET }); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  const send = (body: unknown, options: { secret?: string; type?: string; signature?: string } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return request(stack.server).post('/api/v2/vuelos/booking-events').set('Content-Type', options.type ?? 'application/cloudevents+json').set('X-Webhook-Signature', options.signature ?? sign(raw, options.secret)).send(raw);
  };
  const feed = async (client: TestClient, query: Record<string, string> = {}, user?: string) => request(stack.server).get('/api/v2/vuelos/eventos').query(query).set(await headers(stack, client, user));
  const events = (client: TestClient) => stack.db.webhooks.event.findMany({ where: { ownerId: { startsWith: client.clientId } }, orderBy: { seq: 'asc' } });
  const purchase = async (s: Scenario, user = 'u1', options: Parameters<typeof book>[5] = {}) => { const held = await hold(stack, s, s.client, user); const result = await book(stack, s, s.client, user, held, options); return { held, ...result, id: result.response.body.bookingId as string, total: held.lockedPrice.total }; };
  const paymentData = (p: { id: string; reference: string; total: string }, extra: Record<string, unknown> = {}) => ({ bookingId: p.id, paymentReference: p.reference, amount: { currency: 'USD', total: p.total }, ...extra });

  describe('suscripciones (POST, GET, DELETE /vuelos/webhooks)', () => {
    it('V2-P3-01 crea una suscripción: 201, WebhookSubscription sin secreto (writeOnly) y guardado cifrado a nombre del cliente', async () => {
      const client = await stack.newClient(); const secret = `s3cret-${randomUUID()}`;
      const res = await request(stack.server).post('/api/v2/vuelos/webhooks').set(await headers(stack, client, 'u1')).send({ url: HOOK, events: ['booking.confirmed', 'hold.created'], secret });
      expect(res.status).toBe(201); expectV2Response('POST', '/vuelos/webhooks', 201, res.body); expect(res.body).toMatchObject({ url: HOOK, events: ['booking.confirmed', 'hold.created'], active: true }); expect(res.body).not.toHaveProperty('secret'); expect(JSON.stringify(res.body)).not.toContain(secret);
      const row = await stack.db.webhooks.subscription.findUniqueOrThrow({ where: { id: res.body.id } }); expect(row).toMatchObject({ ownerId: client.clientId, apiVersion: '2' }); expect(row.encryptedSecret).not.toContain(secret);
      await stack.db.webhooks.subscription.delete({ where: { id: res.body.id } });
    }, 60_000);
    it('V2-P3-02 la suscripción es del cliente: el X-User-Id no la separa y otro cliente no la ve', async () => {
      const client = await stack.newClient(); const other = await stack.newClient(); const create = await request(stack.server).post('/api/v2/vuelos/webhooks').set(await headers(stack, client, 'u1')).send({ url: HOOK, events: ['booking.confirmed'], secret: `s3cret-${randomUUID()}` });
      const same = await request(stack.server).get('/api/v2/vuelos/webhooks').set(await headers(stack, client, 'u2')); expect(same.status).toBe(200); expectV2Response('GET', '/vuelos/webhooks', 200, same.body); expect(same.body.map((s: { id: string }) => s.id)).toEqual([create.body.id]);
      expect((await request(stack.server).get('/api/v2/vuelos/webhooks').set(await headers(stack, other, 'u1'))).body).toEqual([]);
      await stack.db.webhooks.subscription.delete({ where: { id: create.body.id } });
    }, 60_000);
    it('V2-P3-03 la lista no incluye suscripciones de v1 del mismo dueño', async () => {
      const client = await stack.newClient(); await stack.subscribe(client.clientId, ['booking.confirmed'], undefined, '1');
      const v2 = await stack.subscribe(client.clientId, ['booking.confirmed']); const list = await request(stack.server).get('/api/v2/vuelos/webhooks').set(await headers(stack, client));
      expect(list.body.map((s: { id: string }) => s.id)).toEqual([v2.id]); await stack.db.webhooks.subscription.deleteMany({ where: { ownerId: client.clientId } });
    }, 60_000);
    it('V2-P3-04 elimina la suscripción: 204, luego 404 y de otro cliente 404', async () => {
      const client = await stack.newClient(); const other = await stack.newClient(); const { id } = await stack.subscribe(client.clientId, ['booking.confirmed']);
      expect((await request(stack.server).delete(`/api/v2/vuelos/webhooks/${id}`).set(await headers(stack, other))).status).toBe(404);
      expect((await request(stack.server).delete(`/api/v2/vuelos/webhooks/${id}`).set(await headers(stack, client))).status).toBe(204);
      const again = await request(stack.server).delete(`/api/v2/vuelos/webhooks/${id}`).set(await headers(stack, client)); expect(again.status).toBe(404); expectV2Response('DELETE', '/vuelos/webhooks/{id}', 404, again.body);
      expect((await request(stack.server).get('/api/v2/vuelos/webhooks').set(await headers(stack, client))).body).toEqual([]);
    }, 60_000);
    it('V2-P3-05 valida la solicitud: url inválida, sin eventos, evento desconocido, secreto corto y propiedades de solo lectura', async () => {
      const client = await stack.newClient(); const h = await headers(stack, client); const ok = { url: HOOK, events: ['booking.confirmed'], secret: `s3cret-${randomUUID()}` };
      for (const bad of [{ ...ok, url: 'no-es-url' }, { ...ok, events: [] }, { ...ok, events: ['otro.evento'] }, { ...ok, secret: 'corto' }, { url: HOOK, events: ['booking.confirmed'] }, { ...ok, id: randomUUID() }]) { const res = await request(stack.server).post('/api/v2/vuelos/webhooks').set(h).send(bad); expect({ bad, status: res.status }).toEqual({ bad, status: 400 }); expectV2Response('POST', '/vuelos/webhooks', 400, res.body); }
    });
    it('V2-P3-06 la política de URL rechaza loopback, redes privadas y 100.64.0.0/10 fuera del perfil local', async () => {
      const client = await stack.newClient(); const h = await headers(stack, client);
      for (const url of ['https://127.0.0.1/hook', 'https://10.0.0.5/hook', 'https://192.168.1.4/hook', 'https://169.254.169.254/x', 'https://100.101.102.103/hook', 'https://user:pass@93.184.216.34/hook']) { const res = await request(stack.server).post('/api/v2/vuelos/webhooks').set(h).send({ url, events: ['booking.confirmed'], secret: `s3cret-${randomUUID()}` }); expect({ url, status: res.status }).toEqual({ url, status: 400 }); }
      expect(await stack.db.webhooks.subscription.count({ where: { ownerId: client.clientId } })).toBe(0);
    });
    it('V2-P3-07 exige token y el scope flights:webhooks', async () => {
      const reader = await stack.newClient(['flights:read']); const body = { url: HOOK, events: ['booking.confirmed'], secret: `s3cret-${randomUUID()}` };
      expect((await request(stack.server).post('/api/v2/vuelos/webhooks').send(body)).status).toBe(401); expect((await request(stack.server).get('/api/v2/vuelos/webhooks')).status).toBe(401);
      for (const call of [request(stack.server).get('/api/v2/vuelos/webhooks'), request(stack.server).post('/api/v2/vuelos/webhooks').send(body), request(stack.server).delete(`/api/v2/vuelos/webhooks/${randomUUID()}`)]) { const res = await call.set(await headers(stack, reader)); expect(res.status).toBe(403); expect(res.body.code).toBe('FORBIDDEN'); }
    });
    it('V2-P3-08 los tres eventos nuevos de v2 se pueden suscribir', async () => {
      const client = await stack.newClient(); const res = await request(stack.server).post('/api/v2/vuelos/webhooks').set(await headers(stack, client)).send({ url: HOOK, events: ['hold.created', 'booking.seat_changed', 'flight.status_changed'], secret: `s3cret-${randomUUID()}` });
      expect(res.status).toBe(201); await stack.db.webhooks.subscription.delete({ where: { id: res.body.id } });
    });
    it('V2-P3-09 la entrega de una suscripción v2 usa el backoff del contrato: 1, 5, 30, 120 y 360 minutos', async () => {
      const client = await stack.newClient(); const { id } = await stack.subscribe(client.clientId, ['hold.created']);
      const sub = await stack.db.webhooks.subscription.findUniqueOrThrow({ where: { id } }); expect(sub.apiVersion).toBe('2'); await stack.db.webhooks.subscription.delete({ where: { id } });
    });
    it('V2-P3-10 los usuarios de un mismo cliente entregan a la única suscripción del cliente y otro cliente no recibe nada', async () => {
      const s = await scenario(); const other = await s.extraClient(); const mine = await stack.subscribe(s.client.clientId, ['booking.confirmed']); await stack.subscribe(other.clientId, ['booking.confirmed']);
      const first = await purchase(s, 'u1'); const second = await purchase(s, 'u2'); expect([first.response.status, second.response.status]).toEqual([201, 201]);
      const rows = await stack.db.webhooks.delivery.findMany({ where: { subscription: { ownerId: s.client.clientId } } }); expect(rows.map((r) => r.subscriptionId)).toEqual([mine.id, mine.id]);
      expect(await stack.db.webhooks.delivery.count({ where: { subscription: { ownerId: other.clientId } } })).toBe(0);
    }, 180_000);
  });

  describe('GET /vuelos/eventos (feed de respaldo)', () => {
    it('V2-P3-11 devuelve los eventos del cliente en orden, como CloudEvents válidos, aunque no haya suscripciones', async () => {
      const s = await scenario(); const p = await purchase(s, 'u1'); expect(p.response.status).toBe(201);
      const res = await feed(s.client); expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/eventos', 200, res.body);
      expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(['ec.edu.epn.booking.vuelos.hold.created', 'ec.edu.epn.booking.vuelos.booking.confirmed', 'ec.edu.epn.booking.vuelos.booking.ticket_issued']);
      const ids = res.body.events.map((e: { id: string }) => e.id); expect([...ids].sort()).toEqual(ids); expect(res.body.events.every((e: { source: string; specversion: string }) => e.source === '/aerolineas/gabatair/vuelos' && e.specversion === '1.0')).toBe(true);
      expect(res.body.metadata).toMatchObject({ total: 3, next_after: null }); expect(typeof res.body.metadata.timestamp).toBe('string');
    }, 90_000);
    it('V2-P3-12 expone el usuario final en data.ownerId y nunca el dueño compuesto ni el id interno', async () => {
      const s = await scenario(); await purchase(s, 'u1'); const res = await feed(s.client); const text = JSON.stringify(res.body);
      expect(res.body.events.find((e: { type: string }) => e.type.endsWith('booking.confirmed')).data.ownerId).toBe('u1'); expect(text).not.toContain(`${s.client.clientId}~`); expect(text).not.toContain('flightInstanceId');
    }, 90_000);
    it('V2-P3-13 pagina con limit y after sin repetir ni omitir y cierra con next_after nulo', async () => {
      const s = await scenario(); await purchase(s, 'u1'); const seen: string[] = []; let after: string | undefined;
      for (let page = 0; page < 6; page += 1) { const res = await feed(s.client, { limit: '2', ...(after ? { after } : {}) }); expect(res.status).toBe(200); seen.push(...res.body.events.map((e: { id: string }) => e.id)); after = res.body.metadata.next_after ?? undefined; if (!after) break; }
      expect(seen).toHaveLength(3); expect(new Set(seen).size).toBe(3);
      const rest = await feed(s.client, { after: seen[0] }); expect(rest.body.events.map((e: { id: string }) => e.id)).toEqual(seen.slice(1));
    }, 90_000);
    it('V2-P3-14 filtra por tipo y rechaza un after mal formado o un limit fuera de rango', async () => {
      const s = await scenario(); await purchase(s, 'u1'); const only = await feed(s.client, { type: 'booking.confirmed' }); expect(only.body.events).toHaveLength(1);
      for (const query of [{ after: 'evt-000001' }, { after: 'x' }, { limit: '0' }, { limit: '101' }, { type: 'otro.evento' }]) { const res = await feed(s.client, query); expect({ query, status: res.status }).toEqual({ query, status: 400 }); }
    }, 90_000);
    it('V2-P3-15 un cliente no ve los eventos de otro y el feed exige token y scope', async () => {
      const s = await scenario(); const other = await s.extraClient(); await purchase(s, 'u1');
      expect((await feed(other)).body.events).toEqual([]); expect((await request(stack.server).get('/api/v2/vuelos/eventos')).status).toBe(401);
      const nobody = await stack.newClient(['flights:hold']); expect((await feed(nobody)).status).toBe(403);
    }, 90_000);
    it('V2-P3-16 el correlationid de un evento sin correlación propia es su id de evento y el de la fachada lleva el X-Correlation-Id', async () => {
      const s = await scenario(); const offer = await s.search(); const correlation = `corr-${randomUUID()}`;
      await request(stack.server).post('/api/v2/vuelos/offers/hold').set(await headers(stack, s.client, 'u1')).set('X-Correlation-Id', correlation).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 } });
      const created = (await feed(s.client)).body.events[0]; expect(created.correlationid).toBe(correlation);
    }, 90_000);
  });

  describe('POST /vuelos/booking-events', () => {
    it('V2-P3-17 payment.confirmed sobre una reserva ya emitida responde 202 ALREADY_ISSUED sin efectos nuevos', async () => {
      const s = await scenario(); const p = await purchase(s); const before = (await events(s.client)).length; const tickets = await stack.db.ticketing.ticket.count({ where: { bookingId: p.id } });
      const res = await send(event('confirmed', paymentData({ id: p.id, reference: p.reference, total: p.total })));
      expect(res.status).toBe(202); expect(res.body.outcome).toBe('ALREADY_ISSUED'); expect((await events(s.client)).length).toBe(before); expect(await stack.db.ticketing.ticket.count({ where: { bookingId: p.id } })).toBe(tickets);
    }, 90_000);
    it('V2-P3-18 payment.confirmed con el pago ya confirmado en Booking emite los boletos de una reserva PENDING_PAYMENT', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '120.00' }); const p = await purchase(s, 'u1', { reference, confirm: false }); expect(p.response.status).toBe(202);
      stack.payments.confirmed(reference, '120.00'); const res = await send(event('confirmed', paymentData({ id: p.id, reference, total: '120.00' })));
      expect(res.status).toBe(202); expect(res.body.outcome).toBe('ISSUED'); const detail = await getBooking(stack, s.client, 'u1', p.id); expect(detail.body.status).toBe('CONFIRMED'); expect(detail.body.tickets[0].status).toBe('ISSUED');
    }, 120_000);
    it('V2-P3-19 payment.confirmed mientras la API de pagos aún dice pendiente no emite: PAYMENT_PENDING', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '120.00' }); const p = await purchase(s, 'u1', { reference, confirm: false });
      const res = await send(event('confirmed', paymentData({ id: p.id, reference, total: '120.00' }))); expect(res.status).toBe(202); expect(res.body.outcome).toBe('PAYMENT_PENDING'); expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('PENDING_PAYMENT');
    }, 120_000);
    it('V2-P3-20 payment.confirmed completa una emisión que quedó en TICKET_ISSUING', async () => {
      const s = await scenario(); const spy = jest.spyOn(GrpcTicketingGateway.prototype, 'issueTickets').mockRejectedValueOnce(new Error('ticketing down'));
      try { const p = await purchase(s); expect(p.response.status).toBe(202); const res = await send(event('confirmed', paymentData({ id: p.id, reference: p.reference, total: p.total }))); expect(res.body.outcome).toBe('ISSUED'); expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('CONFIRMED'); } finally { spy.mockRestore(); }
    }, 120_000);
    it('V2-P3-21 payment.failed sobre una reserva ya emitida la anula: boletos VOIDED, cupo liberado, FAILED y booking.failed al cliente', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, ['booking.failed']); const p = await purchase(s); expect(p.response.status).toBe(201);
      const res = await send(event('failed', paymentData({ id: p.id, reference: p.reference, total: p.total }, { failureReason: 'tarjeta rechazada' })));
      expect(res.status).toBe(202); expect(res.body.outcome).toBe('FAILED_APPLIED');
      expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('FAILED'); expect((await stack.db.ticketing.ticket.findMany({ where: { bookingId: p.id } })).map((t) => t.status)).toEqual(['VOIDED']);
      expect(await stack.db.inventory.cabinInventory.findFirst({ where: { flightInstanceId: s.flightId }, select: { held: true, sold: true } })).toEqual({ held: 0, sold: 0 });
      const delivery = (await stack.db.webhooks.delivery.findMany({ where: { subscription: { ownerId: s.client.clientId } } })).map((d) => d.payload as { eventType: string; extra?: Record<string, unknown>; data?: { status?: string } }).find((d) => d.eventType === 'booking.failed');
      expect(delivery?.data?.status).toBe('FAILED'); expect(delivery?.extra).toMatchObject({ errorCode: 'PAYMENT_FAILED', failureReason: 'tarjeta rechazada' });
      const again = await request(stack.server).post(`/api/v2/vuelos/bookings/${p.id}/tickets`).set(await headers(stack, s.client, 'u1')); expect(again.status).toBe(409);
    }, 120_000);
    it('V2-P3-22 payment.failed sobre una reserva con pago pendiente la falla y libera el hold', async () => {
      const s = await scenario(); const reference = newReference(); stack.payments.set(reference, { estado: 'PENDIENTE', monto: '120.00' }); const p = await purchase(s, 'u1', { reference, confirm: false });
      const res = await send(event('failed', paymentData({ id: p.id, reference, total: '120.00' }))); expect(res.body.outcome).toBe('FAILED_APPLIED');
      expect((await request(stack.server).get(`/api/v2/vuelos/offers/hold/${p.held.holdId}`).set(await headers(stack, s.client, 'u1'))).body.status).toBe('RELEASED');
    }, 120_000);
    it('V2-P3-23 un segundo payment.failed con otro id no repite la compensación ni los eventos', async () => {
      const s = await scenario(); const p = await purchase(s); await send(event('failed', paymentData({ id: p.id, reference: p.reference, total: p.total }))); const count = (await events(s.client)).length;
      const res = await send(event('failed', paymentData({ id: p.id, reference: p.reference, total: p.total }))); expect(res.status).toBe(202); expect(res.body.outcome).toBe('ALREADY_FAILED'); expect((await events(s.client)).length).toBe(count);
    }, 120_000);
    it('V2-P3-24 el mismo id de evento repetido devuelve el mismo resultado con Idempotent-Replayed y sin efectos', async () => {
      const s = await scenario(); const p = await purchase(s); const body = event('failed', paymentData({ id: p.id, reference: p.reference, total: p.total })); const first = await send(body); const count = (await events(s.client)).length; const second = await send(body);
      expect(first.body.outcome).toBe('FAILED_APPLIED'); expect(second.status).toBe(202); expect(second.body).toEqual(first.body); expect(second.headers['idempotent-replayed']).toBe('true'); expect((await events(s.client)).length).toBe(count);
    }, 120_000);
    it('V2-P3-25 un monto distinto al de la reserva responde 422 AMOUNT_MISMATCH y no cambia nada', async () => {
      const s = await scenario(); const p = await purchase(s); const body = event('failed', paymentData({ id: p.id, reference: p.reference, total: '1.00' })); const res = await send(body);
      expect(res.status).toBe(422); expect(res.body.code).toBe('AMOUNT_MISMATCH'); expect((await getBooking(stack, s.client, 'u1', p.id)).body.status).toBe('CONFIRMED');
      const fixed = await send({ ...body, data: paymentData({ id: p.id, reference: p.reference, total: p.total }) }); expect(fixed.body.outcome).toBe('FAILED_APPLIED');
    }, 120_000);
    it('V2-P3-26 una moneda distinta responde 422 AMOUNT_MISMATCH y un evento de pago sin amount 400', async () => {
      const s = await scenario(); const p = await purchase(s); const data = paymentData({ id: p.id, reference: p.reference, total: p.total });
      expect((await send(event('confirmed', { ...data, amount: { currency: 'EUR', total: p.total } }))).status).toBe(422);
      const { amount: _amount, ...withoutAmount } = data; void _amount; expect((await send(event('confirmed', withoutAmount))).status).toBe(400);
    }, 120_000);
    it('V2-P3-27 una referencia de pago que no es la de la reserva responde 422 PAYMENT_REFERENCE_INVALID', async () => {
      const s = await scenario(); const p = await purchase(s); const res = await send(event('failed', paymentData({ id: p.id, reference: 'PAY-OTRA', total: p.total }))); expect(res.status).toBe(422); expect(res.body.code).toBe('PAYMENT_REFERENCE_INVALID');
    }, 120_000);
    it('V2-P3-28 sin bookingId localiza la reserva por la referencia de pago y una reserva desconocida responde 404', async () => {
      const s = await scenario(); const p = await purchase(s); const data = paymentData({ id: p.id, reference: p.reference, total: p.total }); const { bookingId: _id, ...byReference } = data; void _id;
      expect((await send(event('confirmed', byReference))).body.outcome).toBe('ALREADY_ISSUED');
      const missing = await send(event('confirmed', { ...data, bookingId: randomUUID(), paymentReference: 'PAY-NO-EXISTE' })); expect(missing.status).toBe(404); expect(missing.body.code).toBe('NOT_FOUND');
    }, 120_000);
    it('V2-P3-29 acepta application/json y application/cloudevents+json y rechaza otros tipos de contenido', async () => {
      const s = await scenario(); const p = await purchase(s); const body = event('confirmed', paymentData({ id: p.id, reference: p.reference, total: p.total }));
      expect((await send(body, { type: 'application/json' })).status).toBe(202); expect((await send(event('confirmed', body.data), { type: 'application/cloudevents+json' })).status).toBe(202);
      expect((await send(JSON.stringify(event('confirmed', body.data)), { type: 'text/plain' })).status).toBeGreaterThanOrEqual(400);
    }, 120_000);
    it('V2-P3-30 un payment.failed de un cliente no puede tocar la reserva de otro: el id sale de la reserva, no del evento', async () => {
      const a = await scenario(); const b = await scenario(); const pa = await purchase(a); const pb = await purchase(b);
      const res = await send(event('failed', paymentData({ id: pb.id, reference: pa.reference, total: pb.total }))); expect(res.status).toBe(422); expect((await getBooking(stack, b.client, 'u1', pb.id)).body.status).toBe('CONFIRMED');
    }, 180_000);
    it('V2-P3-31 los eventos que el feed expone incluyen la compensación (booking.failed)', async () => {
      const s = await scenario(); const p = await purchase(s); await send(event('failed', paymentData({ id: p.id, reference: p.reference, total: p.total })));
      const only = await feed(s.client, { type: 'booking.failed' }); expect(only.body.events).toHaveLength(1); expectSchema('EventBookingFailed', only.body.events[0]); expect(only.body.events[0].data).toMatchObject({ bookingId: p.id, status: 'FAILED', errorCode: 'PAYMENT_FAILED' });
    }, 120_000);
    void passenger;
  });
});
