import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { expectSchema, expectV2Response } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, headers, hold, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const fingerprint = () => randomUUID();

describeReal('F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  const scenario = async (options: Parameters<Stack['scenario']>[0] = {}) => { const value = await stack.scenario(options); scenarios.push(value); return value; };
  beforeAll(async () => { stack = await startStack(); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);
  const post = (path: string) => request(stack.server).post(path);

  describe('POST /vuelos/search', () => {
    it('V2-P2-01 devuelve las ofertas del vuelo, cumple SearchResponse y no expone ids internos', async () => {
      const s = await scenario();
      const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [{ origin: s.origin, destination: s.destination, departureDate: s.date }], passengers: { adults: 1 } });
      expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/search', 200, res.body);
      expect(res.body.offers.some((o: { itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }) => o.itineraries[0].segments[0].flightNumber === s.flightNumber)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('flightInstanceId');
    }, 60_000);
    it('V2-P2-02 es público: no pide token', async () => {
      const s = await scenario(); const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [{ origin: s.origin, destination: s.destination, departureDate: s.date }], passengers: { adults: 1 } });
      expect(res.status).toBe(200);
    }, 60_000);
    it('V2-P2-03 sin X-Device-Fingerprint responde 400 ProblemDetails', async () => {
      const res = await post('/api/v2/vuelos/search').send({ itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2099-01-01' }], passengers: { adults: 1 } });
      expect(res.status).toBe(400); expectV2Response('POST', '/vuelos/search', 400, res.body); expect(res.body.code).toBe('VALIDATION_FAILED');
    });
    it('V2-P2-04 más infantes que adultos responde 422 INFANT_WITHOUT_ADULT', async () => {
      const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2099-01-01' }], passengers: { adults: 1, infants: 2 } });
      expect(res.status).toBe(422); expect(res.body.code).toBe('INFANT_WITHOUT_ADULT'); expectV2Response('POST', '/vuelos/search', 422, res.body);
    });
    it('V2-P2-05 más de 9 pasajeros con asiento responde 422', async () => {
      const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2099-01-01' }], passengers: { adults: 6, youths: 3, children: 1 } });
      expect(res.status).toBe(422); expectV2Response('POST', '/vuelos/search', 422, res.body);
    });
    it('V2-P2-06 una ruta sin vuelos responde 200 con cero ofertas', async () => {
      const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [{ origin: 'ZZY', destination: 'YYZ', departureDate: '2099-01-01' }], passengers: { adults: 1 } });
      expect(res.status).toBe(200); expect(res.body).toEqual({ totalOffers: 0, offers: [] });
    });
    it('V2-P2-07 aplica los valores por defecto del desglose de pasajeros', async () => {
      const s = await scenario(); const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [{ origin: s.origin, destination: s.destination, departureDate: s.date }], passengers: {} });
      expect(res.status).toBe(200); expect(res.body.totalOffers).toBeGreaterThan(0);
    }, 60_000);
    it('V2-P2-08 un código IATA inválido o una fecha inválida responden 400 con invalidParams', async () => {
      for (const bad of [{ origin: 'uio', destination: 'GYE', departureDate: '2099-01-01' }, { origin: 'UIO', destination: 'GYE', departureDate: 'mañana' }]) {
        const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [bad], passengers: { adults: 1 } });
        expect(res.status).toBe(400); expect(res.body.invalidParams.length).toBeGreaterThan(0); expectSchema('ProblemDetails', res.body);
      }
    });
    it('V2-P2-09 rechaza propiedades desconocidas en la solicitud', async () => {
      const res = await post('/api/v2/vuelos/search').set('X-Device-Fingerprint', fingerprint()).send({ itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2099-01-01' }], passengers: { adults: 1 }, extra: true });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /vuelos/offers/{offerId}/seatmap', () => {
    it('V2-P2-10 devuelve el mapa con status por asiento y cumple SeatMapResponse', async () => {
      const s = await scenario(); const offer = await s.search();
      const res = await request(stack.server).get(`/api/v2/vuelos/offers/${offer.offerId}/seatmap`).query({ segmentId: offer.segmentId });
      expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/offers/{offerId}/seatmap', 200, res.body);
      const seats = res.body.cabins.flatMap((c: { rows: Array<{ seats: Array<{ seatNumber: string; isAvailable: boolean; status: string }> }> }) => c.rows.flatMap((r) => r.seats));
      expect(seats.map((seat: { seatNumber: string }) => seat.seatNumber).sort()).toEqual(['1A', '1B', '1C']);
      expect(seats.every((seat: { isAvailable: boolean; status: string }) => seat.isAvailable && seat.status === 'AVAILABLE')).toBe(true);
    }, 60_000);
    it('V2-P2-11 un asiento reservado pasa a BOOKED y isAvailable a false', async () => {
      const s = await scenario(); const client = s.client; const held = await hold(stack, s, client, 'u1');
      const booked = await book(stack, s, client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId: held.offer.segmentId, seatNumber: '1B' }] })] });
      expect(booked.response.status).toBe(201);
      const res = await request(stack.server).get(`/api/v2/vuelos/offers/${held.offer.offerId}/seatmap`).query({ segmentId: held.offer.segmentId });
      const seat = res.body.cabins[0].rows.flatMap((r: { seats: Array<{ seatNumber: string; isAvailable: boolean; status: string }> }) => r.seats).find((x: { seatNumber: string }) => x.seatNumber === '1B');
      expect(seat).toMatchObject({ isAvailable: false, status: 'BOOKED' });
    }, 90_000);
    it('V2-P2-12 un offerId que no es UUID o no existe responde 404 NOT_FOUND', async () => {
      const segmentId = randomUUID();
      for (const offerId of ['OFF-UIO-GYE-01', randomUUID()]) { const res = await request(stack.server).get(`/api/v2/vuelos/offers/${offerId}/seatmap`).query({ segmentId }); expect({ offerId, status: res.status }).toEqual({ offerId, status: 404 }); expectSchema('ProblemDetails', res.body); }
    });
    it('V2-P2-13 sin segmentId responde 400', async () => { expect((await request(stack.server).get(`/api/v2/vuelos/offers/${randomUUID()}/seatmap`)).status).toBe(400); });
  });

  describe('GET /vuelos/flights/{flightNumber}/status', () => {
    it('V2-P2-14 devuelve el estado público, delayMinutes y cumple FlightStatus', async () => {
      const s = await scenario(); const res = await request(stack.server).get(`/api/v2/vuelos/flights/${s.flightNumber}/status`).query({ date: s.date });
      expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/flights/{flightNumber}/status', 200, res.body); expect(res.body).toMatchObject({ flightNumber: s.flightNumber, date: s.date, status: 'SCHEDULED', delayMinutes: 0 });
    });
    it('V2-P2-15 un vuelo inexistente responde 404 y una fecha inválida 400', async () => {
      const missing = await request(stack.server).get('/api/v2/vuelos/flights/ZZ9999/status').query({ date: '2099-01-01' }); expect(missing.status).toBe(404); expectV2Response('GET', '/vuelos/flights/{flightNumber}/status', 404, missing.body);
      expect((await request(stack.server).get('/api/v2/vuelos/flights/ZZ9999/status').query({ date: 'bad' })).status).toBe(400);
    });
    it('V2-P2-16 el estado refleja un retraso operativo como delayMinutes positivo', async () => {
      const s = await scenario(); const estimated = new Date(s.departure.getTime() + 45 * 60_000);
      await stack.db.operations.operationalFlight.update({ where: { flightInstanceId: s.flightId }, data: { estimatedDepartureAt: estimated, status: 'DELAYED' } });
      const res = await request(stack.server).get(`/api/v2/vuelos/flights/${s.flightNumber}/status`).query({ date: s.date });
      expect(res.status).toBe(200); expect(res.body).toMatchObject({ status: 'DELAYED', delayMinutes: 45 }); expectV2Response('GET', '/vuelos/flights/{flightNumber}/status', 200, res.body);
    });
  });

  describe('POST /vuelos/offers/hold', () => {
    const holdBody = (offer: Awaited<ReturnType<Scenario['search']>>, extra: Record<string, unknown> = {}) => ({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 }, ...extra });
    it('V2-P2-17 crea el hold: 201, HoldResponse, Location y enlaces', async () => {
      const s = await scenario(); const client = s.client; const offer = await s.search();
      const res = await post('/api/v2/vuelos/offers/hold').set(await headers(stack, client, 'u1')).set('Idempotency-Key', randomUUID()).send(holdBody(offer));
      expect(res.status).toBe(201); expectV2Response('POST', '/vuelos/offers/hold', 201, res.body);
      expect(res.body).toMatchObject({ status: 'HELD', lockedPrice: { total: offer.grandTotal.total } }); expect(res.headers.location).toBe(`http://gateway.test/api/v2/vuelos/offers/hold/${res.body.holdId}`);
      expect(res.body._links.release).toEqual({ href: res.headers.location, method: 'DELETE' }); expect(res.body._links.book.method).toBe('POST');
    }, 60_000);
    it('V2-P2-18 respeta ttlMinutes dentro de 5 a 30', async () => {
      const s = await scenario(); const client = s.client; const offer = await s.search(); const before = Date.now();
      const res = await post('/api/v2/vuelos/offers/hold').set(await headers(stack, client, 'u1')).set('Idempotency-Key', randomUUID()).send(holdBody(offer, { ttlMinutes: 10 }));
      expect(res.status).toBe(201); expect(res.body.ttlMinutes).toBe(10); expect(Math.abs(Date.parse(res.body.expiresAt) - (before + 10 * 60_000))).toBeLessThan(30_000);
    }, 60_000);
    it('V2-P2-19 ttlMinutes fuera de 5 a 30 responde 400', async () => {
      const client = await stack.newClient();
      for (const ttlMinutes of [4, 31, 0, -1]) { const res = await post('/api/v2/vuelos/offers/hold').set(await headers(stack, client, 'u1')).set('Idempotency-Key', randomUUID()).send({ offerId: randomUUID(), itinerarySelections: [{ itineraryId: randomUUID(), cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }], passengersBreakdown: { adults: 1 }, ttlMinutes }); expect({ ttlMinutes, status: res.status }).toEqual({ ttlMinutes, status: 400 }); }
    });
    it('V2-P2-20 un reintento con la misma clave y cuerpo devuelve 200, Idempotent-Replayed y el mismo hold', async () => {
      const s = await scenario(); const client = s.client; const offer = await s.search(); const key = randomUUID(); const h = await headers(stack, client, 'u1');
      const first = await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(holdBody(offer)); const second = await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(holdBody(offer));
      expect(first.status).toBe(201); expect(second.status).toBe(200); expect(second.headers['idempotent-replayed']).toBe('true'); expect(second.body).toEqual(first.body); expectV2Response('POST', '/vuelos/offers/hold', 200, second.body);
      expect(await stack.db.inventory.hold.count({ where: { ownerId: { startsWith: client.clientId } } })).toBe(1);
    }, 60_000);
    it('V2-P2-21 la misma clave con otro cuerpo responde 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const s = await scenario(); const client = s.client; const offer = await s.search(); const key = randomUUID(); const h = await headers(stack, client, 'u1');
      await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(holdBody(offer));
      const res = await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(holdBody(offer, { ttlMinutes: 7 }));
      expect(res.status).toBe(409); expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED'); expectV2Response('POST', '/vuelos/offers/hold', 409, res.body);
    }, 60_000);
    it('V2-P2-22 el orden de las propiedades del cuerpo no cuenta como otro cuerpo', async () => {
      const s = await scenario(); const client = s.client; const offer = await s.search(); const key = randomUUID(); const h = await headers(stack, client, 'u1'); const body = holdBody(offer);
      await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(body);
      const reordered = Object.fromEntries(Object.entries(body).reverse()); const res = await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(reordered);
      expect(res.status).toBe(200);
    }, 60_000);
    it('V2-P2-23 la Idempotency-Key es obligatoria y debe ser UUID v4', async () => {
      const client = await stack.newClient(); const h = await headers(stack, client, 'u1'); const body = { offerId: randomUUID(), itinerarySelections: [{ itineraryId: randomUUID(), cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }], passengersBreakdown: { adults: 1 } };
      expect((await post('/api/v2/vuelos/offers/hold').set(h).send(body)).status).toBe(400);
      expect((await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', 'not-a-uuid').send(body)).status).toBe(400);
      expect((await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', '9b1deb4d-3b7d-1bad-9bdd-2b0d7b3dcb6d').send(body)).status).toBe(400);
    });
    it('V2-P2-24 sin token responde 401 y con un scope que no corresponde 403', async () => {
      const client = await stack.newClient(['flights:read']); const body = { offerId: randomUUID(), itinerarySelections: [{ itineraryId: randomUUID(), cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }], passengersBreakdown: { adults: 1 } };
      const anonymous = await post('/api/v2/vuelos/offers/hold').set('Idempotency-Key', randomUUID()).send(body); expect(anonymous.status).toBe(401); expect(anonymous.body.code).toBe('UNAUTHORIZED'); expectV2Response('POST', '/vuelos/offers/hold', 401, anonymous.body);
      const forbidden = await post('/api/v2/vuelos/offers/hold').set(await headers(stack, client, 'u1')).set('Idempotency-Key', randomUUID()).send(body); expect(forbidden.status).toBe(403); expect(forbidden.body.code).toBe('FORBIDDEN');
    });
    it('V2-P2-25 una oferta inexistente o con id que no es UUID responde 410 OFFER_NO_LONGER_AVAILABLE', async () => {
      const client = await stack.newClient(); const h = await headers(stack, client, 'u1');
      for (const offerId of [randomUUID(), 'OFF-UIO-GYE-20261120-01']) { const res = await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', randomUUID()).send({ offerId, itinerarySelections: [{ itineraryId: randomUUID(), cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }], passengersBreakdown: { adults: 1 } }); expect({ offerId, status: res.status, code: res.body.code }).toEqual({ offerId, status: 410, code: 'OFFER_NO_LONGER_AVAILABLE' }); expectV2Response('POST', '/vuelos/offers/hold', 410, res.body); }
    });
    it('V2-P2-26 más infantes que adultos en el hold responde 422 INFANT_WITHOUT_ADULT', async () => {
      const client = await stack.newClient(); const res = await post('/api/v2/vuelos/offers/hold').set(await headers(stack, client, 'u1')).set('Idempotency-Key', randomUUID()).send({ offerId: randomUUID(), itinerarySelections: [{ itineraryId: randomUUID(), cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }], passengersBreakdown: { adults: 1, infants: 2 } });
      expect(res.status).toBe(422); expect(res.body.code).toBe('INFANT_WITHOUT_ADULT');
    });
    it('V2-P2-27 publica hold.created una sola vez al cliente suscrito y no a otro cliente', async () => {
      const s = await scenario(); const client = s.client; const other = await s.extraClient(); await stack.subscribe(client.clientId, ['hold.created']); await stack.subscribe(other.clientId, ['hold.created']);
      const offer = await s.search(); const key = randomUUID(); const h = await headers(stack, client, 'u1');
      const first = await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(holdBody(offer)); await post('/api/v2/vuelos/offers/hold').set(h).set('Idempotency-Key', key).send(holdBody(offer));
      const rows = await stack.db.webhooks.delivery.findMany({ where: { subscription: { ownerId: client.clientId } } });
      expect(rows).toHaveLength(1); expect(rows[0].payload).toMatchObject({ eventType: 'hold.created', data: { holdId: first.body.holdId }, extra: { offerId: offer.offerId, seatsHeld: 1, ttlMinutes: first.body.ttlMinutes } });
      expect(await stack.db.webhooks.delivery.count({ where: { subscription: { ownerId: other.clientId } } })).toBe(0);
    }, 60_000);
    it('V2-P2-28 el hold ocupa un cupo del vuelo y liberarlo lo devuelve', async () => {
      const s = await scenario({ sellable: 1 }); const client = await stack.newClient(); const held = await hold(stack, s, client, 'u1');
      const cabin = () => stack.db.inventory.cabinInventory.findFirst({ where: { flightInstanceId: s.flightId }, select: { held: true, sold: true } });
      expect(await cabin()).toEqual({ held: 1, sold: 0 });
      const released = await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, client, 'u1')); expect(released.status).toBe(204);
      expect(await cabin()).toEqual({ held: 0, sold: 0 });
    }, 90_000);
  });

  describe('GET y DELETE /vuelos/offers/hold/{holdId}', () => {
    it('V2-P2-29 consulta el hold con tiempo restante, enlaces y cumple HoldStatusResponse', async () => {
      const s = await scenario(); const client = s.client; const held = await hold(stack, s, client, 'u1');
      const res = await request(stack.server).get(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, client, 'u1'));
      expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/offers/hold/{holdId}', 200, res.body); expect(res.body).toMatchObject({ holdId: held.holdId, status: 'HELD' }); expect(res.body.remainingSeconds).toBeGreaterThan(0); expect(res.body.remainingSeconds).toBeLessThanOrEqual(20 * 60);
    }, 60_000);
    it('V2-P2-30 otro usuario del mismo cliente u otro cliente reciben 404', async () => {
      const s = await scenario(); const client = s.client; const other = await s.extraClient(); const held = await hold(stack, s, client, 'u1');
      for (const [c, user] of [[client, 'u2'], [other, 'u1']] as const) { const res = await request(stack.server).get(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, c, user)); expect(res.status).toBe(404); expectV2Response('GET', '/vuelos/offers/hold/{holdId}', 404, res.body); }
    }, 60_000);
    it('V2-P2-31 libera el hold: 204, queda RELEASED y liberar otra vez también responde 204', async () => {
      const s = await scenario(); const client = s.client; const held = await hold(stack, s, client, 'u1'); const h = await headers(stack, client, 'u1');
      expect((await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(h)).status).toBe(204);
      expect((await request(stack.server).get(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(h)).body.status).toBe('RELEASED');
      expect((await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(h)).status).toBe(204);
    }, 90_000);
    it('V2-P2-32 liberar el hold de otro responde 404 y un hold inexistente 404', async () => {
      const s = await scenario(); const client = s.client; const other = await s.extraClient(); const held = await hold(stack, s, client, 'u1');
      expect((await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, other, 'u1'))).status).toBe(404);
      expect((await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${randomUUID()}`).set(await headers(stack, client, 'u1'))).status).toBe(404);
    }, 60_000);
    it('V2-P2-33 un hold ya convertido en reserva responde 409 HOLD_ALREADY_CONSUMED al liberarlo', async () => {
      const s = await scenario(); const client = s.client; const held = await hold(stack, s, client, 'u1'); const booked = await book(stack, s, client, 'u1', held); expect(booked.response.status).toBe(201);
      const res = await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, client, 'u1'));
      expect(res.status).toBe(409); expect(res.body.code).toBe('HOLD_ALREADY_CONSUMED'); expectV2Response('DELETE', '/vuelos/offers/hold/{holdId}', 409, res.body);
    }, 90_000);
    it('V2-P2-34 holdId que no es UUID responde 400 y sin token 401', async () => {
      const client = await stack.newClient(); expect((await request(stack.server).get('/api/v2/vuelos/offers/hold/nope').set(await headers(stack, client, 'u1'))).status).toBe(400);
      expect((await request(stack.server).get(`/api/v2/vuelos/offers/hold/${randomUUID()}`)).status).toBe(401);
    });
  });
});
