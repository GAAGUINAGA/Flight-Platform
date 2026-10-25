import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { PrismaClient as InventoryPrisma } from '@prisma/client';
import type { PrismaClient as PricingPrisma } from '../../../../microservices/pricing-service/src/infrastructure/persistence/prisma-client/client';
import type { PrismaClient as AncillariesPrisma } from '../../../../microservices/ancillaries-service/src/infrastructure/persistence/prisma-client/client';
import type { PrismaClient as TicketingPrisma } from '../../../../microservices/ticketing-service/src/infrastructure/persistence/prisma-client/client';
import type { PrismaClient as WebhooksPrisma } from '../../../../microservices/webhooks-service/src/infrastructure/persistence/prisma-client/client';
import type { PrismaClient as ReservationPrisma } from '../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-client/client';
import type { PrismaClient as OperationsPrisma } from '../../../../microservices/operations-service/src/infrastructure/persistence/prisma-client/client';
import { createGatewayApp } from '../../src/app';
import { loadConfig } from '../../src/config';

/** Lo que el arnés real (real-stack.e2e.spec.ts) pone a disposición de la matriz. */
export interface MatrixHarness {
  server(): Server;
  /** Devuelve `Bearer <jwt>` firmado por el emisor de desarrollo del Gateway bajo prueba. */
  token(scope: string, owner: string, role: string): string;
  validate(schema: string, body: unknown): void;
  route(): { origin: string; destination: string };
  internalKey: string;
  dbs(): { inventory: InventoryPrisma; pricing: PricingPrisma; ancillaries: AncillariesPrisma; ticketing: TicketingPrisma; webhooks: WebhooksPrisma; reservation: ReservationPrisma; operations: OperationsPrisma };
}

type Role = 'anonymous' | 'customer' | 'partner' | 'admin';
type Actor = Exclude<Role, 'anonymous'>;
type Method = 'get' | 'post' | 'put' | 'delete';
type Expected = Record<Role, number>;
type Response = request.Response;

const roles: Role[] = ['anonymous', 'customer', 'partner', 'admin'];
const actors: Actor[] = ['customer', 'partner', 'admin'];
// PLAN §2.3: scopes canónicos de cada rol.
const scopesOf: Record<Actor, string> = {
  customer: 'flights:read flights:hold flights:book flights:cancel',
  partner: 'flights:read flights:hold flights:book flights:cancel flights:webhooks',
  admin: 'flights:read flights:hold flights:book flights:cancel flights:webhooks flights:admin'
};
const victimOf: Record<Actor, Actor> = { customer: 'partner', partner: 'admin', admin: 'customer' };

interface Ctx { sub: string; bearer: string; passengerId: string; holdRead: string; holdBook: string; bookingId: string; checkInBookingId: string; ticketId: string; changeOfferId: string; quoteId: string; webhookId: string; adminFlightId: string }
interface Pick { offerId: string; itineraryId: string; segmentId: string; cabinClass: string; fareBrand: string }
interface Op {
  id: string; label: string; method: Method; path: (c: Ctx) => string; body?: (c: Ctx) => object | undefined; idempotent?: boolean;
  expected: Expected; check?: (response: Response, c: Ctx) => void;
}

const open: Expected = { anonymous: 200, customer: 200, partner: 200, admin: 200 };
const owned = (code: number): Expected => ({ anonymous: 401, customer: code, partner: code, admin: code });
const partnerOrAdmin = (code: number): Expected => ({ anonymous: 401, customer: 403, partner: code, admin: code });
const adminOnly = (code: number): Expected => ({ anonymous: 401, customer: 403, partner: 403, admin: code });

/** Borra todo lo que crearon los `sub` indicados (holds, reservas, tickets, equipaje, check-ins, ofertas de cambio y webhooks). */
export async function cleanupOwnerData(dbs: ReturnType<MatrixHarness['dbs']>, owners: string[]): Promise<void> {
  const { inventory, pricing, ancillaries, ticketing, webhooks, reservation, operations } = dbs;
  const bookingIds = (await reservation.reservation.findMany({ where: { ownerId: { in: owners } }, select: { id: true } })).map((row) => row.id);
  const holdIds = (await inventory.hold.findMany({ where: { ownerId: { in: owners } }, select: { id: true } })).map((row) => row.id);
  await webhooks.subscription.deleteMany({ where: { ownerId: { in: owners } } });
  await operations.checkIn.deleteMany({ where: { ownerId: { in: owners } } });
  await ancillaries.baggageAllowance.deleteMany({ where: { ownerId: { in: owners } } }); await ancillaries.baggageItem.deleteMany({ where: { ownerId: { in: owners } } });
  await ancillaries.seatAssignment.deleteMany({ where: { ownerId: { in: owners } } }); await ancillaries.bookingOwner.deleteMany({ where: { ownerId: { in: owners } } });
  await ticketing.ticket.deleteMany({ where: { ownerId: { in: owners } } }); await ticketing.issuanceRequest.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await reservation.reservation.deleteMany({ where: { ownerId: { in: owners } } });
  await pricing.changeOffer.deleteMany({ where: { ownerId: { in: owners } } }); await pricing.priceLock.deleteMany({ where: { holdId: { in: holdIds } } });
  await inventory.reservedInventory.deleteMany({ where: { holdId: { in: holdIds } } }); await inventory.hold.deleteMany({ where: { id: { in: holdIds } } });
}

export function registerAuthorizationMatrix(harness: MatrixHarness): void {
  describe('PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real', () => {
    const blank = (): Ctx => ({ sub: `matrix-${randomUUID()}`, bearer: '', passengerId: randomUUID(), holdRead: randomUUID(), holdBook: randomUUID(), bookingId: randomUUID(), checkInBookingId: randomUUID(), ticketId: randomUUID(), changeOfferId: randomUUID(), quoteId: randomUUID(), webhookId: randomUUID(), adminFlightId: randomUUID() });
    const anonymous = blank();
    const ctx: Record<Actor, Ctx> = { customer: blank(), partner: blank(), admin: blank() };
    const of = (role: Role): Ctx => (role === 'anonymous' ? anonymous : ctx[role]);

    const startedAt = new Date();
    const flightA = randomUUID(); const flightB = randomUUID(); const flightC = randomUUID();
    const adminFlights: string[] = [];
    const base = randomInt(1000, 9990); const numberA = `FP${base}`; const numberB = `FP${base + 1}`; const numberC = `FP${base + 2}`;
    const aircraft = `M${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const departureA = new Date(Date.now() + 5 * 86_400_000); departureA.setUTCHours(14, randomInt(0, 60), 0, 0);
    const departureB = new Date(departureA.getTime() + 86_400_000);
    const departureC = new Date(Date.now() + 36 * 3_600_000);
    const day = (value: Date) => value.toISOString().slice(0, 10);
    const { origin, destination } = harness.route();
    let pickA: Pick; let pickC: Pick;

    const passenger = (id: string, segmentId: string, seat?: string) => ({ passengerId: id, passengerType: 'ADULT', firstName: 'Matrix', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'MATRIX123', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'matrix@example.invalid', phone: '+593999999999' }, assignedSeats: seat ? [{ segmentId, seatNumber: seat }] : [], extraBaggage: [] });
    const holdBody = (pick: Pick) => ({ offerId: pick.offerId, itinerarySelections: [{ itineraryId: pick.itineraryId, cabinClass: pick.cabinClass, fareBrand: pick.fareBrand }], passengersBreakdown: { adults: 1 } });
    const bookingBody = (c: Ctx, holdId: string, pick: Pick, seat?: string) => ({ holdId, passengers: [passenger(c.passengerId, pick.segmentId, seat)], payment: { paymentReference: `pay_ok_${randomUUID()}` } });
    const fareBody = (flightInstanceId: string) => ({ flightInstanceId, cabinClass: 'ECONOMY', fareBrand: 'FLEX', price: { currency: 'USD', baseFare: '100.00', taxes: '20.00', total: '120.00' }, fareRules: { isRefundable: true, isChangeable: false }, baggageAllowance: { personalItemIncluded: true, carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { currency: 'USD', total: '50.00' } });
    const adminFlightBody = () => { const departure = new Date(Date.now() + 9 * 86_400_000); departure.setUTCHours(10, 0, 0, 0); return { flightNumber: `FP${randomInt(1000, 10000)}`, departureIata: origin, arrivalIata: destination, departureAt: departure.toISOString(), arrivalAt: new Date(departure.getTime() + 3_600_000).toISOString(), cabins: [{ cabinClass: 'ECONOMY', capacity: 20 }] }; };
    const webhookBody = () => ({ url: 'https://93.184.216.34/matrix', events: ['booking.confirmed'], secret: `matrix-${randomUUID()}` });
    const searchBody = (date: string) => ({ itineraries: [{ origin, destination, departureDate: date }], passengers: { adults: 1 } });

    const send = (role: Role, method: Method, path: string, body?: object, idempotent = false, bearer?: string) => {
      let call = request(harness.server())[method](path).set('X-Device-Fingerprint', randomUUID());
      const authorization = bearer ?? (role === 'anonymous' ? undefined : ctx[role].bearer);
      if (authorization) call = call.set('Authorization', authorization);
      if (idempotent) call = call.set('Idempotency-Key', randomUUID());
      return body ? call.send(body) : call;
    };
    const pickFrom = (search: Response, flightNumber: string): Pick => {
      const offer = search.body.offers.find((item: { itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }) => item.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === flightNumber)));
      expect(offer).toBeTruthy();
      const itinerary = offer.itineraries.find((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((segment) => segment.flightNumber === flightNumber));
      const option = itinerary.pricingOptions.find((item: { cabinClass: string; fareBrand: string }) => item.cabinClass === 'ECONOMY' && item.fareBrand === 'CLASSIC');
      return { offerId: offer.offerId, itineraryId: itinerary.itineraryId, segmentId: itinerary.segments.find((segment: { flightNumber: string }) => segment.flightNumber === flightNumber).segmentId, cabinClass: option.cabinClass, fareBrand: option.fareBrand };
    };
    const createHold = async (actor: Actor, pick: Pick) => { const response = await send(actor, 'post', '/flights/v1/offers/hold', holdBody(pick), true); expect(response.status).toBe(201); return response.body.holdId as string; };
    const createBooking = async (actor: Actor, holdId: string, pick: Pick, seat?: string) => { const response = await send(actor, 'post', '/flights/v1/bookings', bookingBody(ctx[actor], holdId, pick, seat), true); expect(response.status).toBe(201); return response.body.bookingId as string; };

    beforeAll(async () => {
      // El arnés firma con una llave que existe solo después de su propio beforeAll.
      for (const actor of actors) ctx[actor].bearer = harness.token(scopesOf[actor], ctx[actor].sub, actor);
      const { inventory, pricing, ancillaries } = harness.dbs();
      const operations = harness.dbs().operations;
      await inventory.flightInstance.create({ data: { id: flightA, flightNumber: numberA, departureIata: origin, arrivalIata: destination, departureAt: departureA, arrivalAt: new Date(departureA.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 40 } } } });
      await inventory.flightInstance.create({ data: { id: flightB, flightNumber: numberB, departureIata: origin, arrivalIata: destination, departureAt: departureB, arrivalAt: new Date(departureB.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 40 } } } });
      await inventory.flightInstance.create({ data: { id: flightC, flightNumber: numberC, departureIata: origin, arrivalIata: destination, departureAt: departureC, arrivalAt: new Date(departureC.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 40 } } } });
      await operations.operationalFlight.create({ data: { flightInstanceId: flightC, flightNumber: numberC, date: day(departureC), marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: origin, arrivalIata: destination, scheduledDepartureAt: departureC, scheduledArrivalAt: new Date(departureC.getTime() + 3_600_000), aircraft, status: 'SCHEDULED' } });
      for (const id of [flightA, flightB, flightC]) await pricing.fare.create({ data: { flightInstanceId: id, cabinClass: 'ECONOMY', brand: 'CLASSIC', baseFareMinor: 10000, taxesMinor: 2000, rules: { changeable: true, refundable: true }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 } });
      for (const seat of ['1A', '1B', '1C']) await ancillaries.seatLayout.create({ data: { aircraft, cabinClass: 'ECONOMY', seatNumber: seat, rowNumber: 1, characteristics: ['WINDOW'] } });
      const searchA = await send('anonymous', 'post', '/flights/v1/search', searchBody(day(departureA))); expect(searchA.status).toBe(200); pickA = pickFrom(searchA, numberA);
      const searchC = await send('anonymous', 'post', '/flights/v1/search', searchBody(day(departureC))); expect(searchC.status).toBe(200); pickC = pickFrom(searchC, numberC);
      for (const [index, actor] of actors.entries()) {
        const c = ctx[actor];
        c.holdRead = await createHold(actor, pickA);
        c.holdBook = await createHold(actor, pickA);
        c.bookingId = await createBooking(actor, await createHold(actor, pickA), pickA);
        c.checkInBookingId = await createBooking(actor, await createHold(actor, pickC), pickC, ['1A', '1B', '1C'][index]);
        const tickets = await send(actor, 'get', `/flights/v1/bookings/${c.bookingId}/tickets`); expect(tickets.status).toBe(200);
        c.ticketId = tickets.body.tickets.find((item: { status: string }) => item.status === 'ISSUED').ticketId;
      }
      // Suscripciones previas, para probar el borrado de una suscripción ajena (OP-17).
      for (const actor of ['partner', 'admin'] as const) {
        const response = await send(actor, 'post', '/flights/v1/webhooks', webhookBody()); expect(response.status).toBe(201); ctx[actor].webhookId = response.body.id;
      }
    }, 240_000);

    afterAll(async () => {
      const { inventory, pricing, ancillaries, operations } = harness.dbs();
      await cleanupOwnerData(harness.dbs(), actors.map((actor) => ctx[actor].sub));
      const flights = [flightA, flightB, flightC];
      const offers = await pricing.offer.findMany({ where: { createdAt: { gte: startedAt } }, select: { id: true, snapshot: true } });
      const offerIds = offers.filter((item) => flights.some((id) => JSON.stringify(item.snapshot).includes(id))).map((item) => item.id);
      await pricing.offer.deleteMany({ where: { id: { in: offerIds } } });
      const all = [...flights, ...adminFlights];
      await pricing.fare.deleteMany({ where: { flightInstanceId: { in: all } } }); await ancillaries.seatLayout.deleteMany({ where: { aircraft } });
      await operations.operationalFlight.deleteMany({ where: { flightInstanceId: { in: all } } }); await inventory.flightInstance.deleteMany({ where: { id: { in: all } } });
    }, 60_000);

    const problem = (response: Response) => { expect(response.type).toContain('application/problem+json'); harness.validate('ProblemDetails', response.body); };
    const items = (schema: string) => (response: Response) => { expect(Array.isArray(response.body)).toBe(true); for (const item of response.body) harness.validate(schema, item); };

    // Operaciones en orden de ciclo de vida: la cancelación y el cierre de vuelo van al final porque consumen el estado.
    const ops: Op[] = [
      { id: 'OP-01', label: 'POST /search', method: 'post', path: () => '/flights/v1/search', body: () => searchBody(day(departureA)), expected: open, check: (r) => harness.validate('SearchResponse', r.body) },
      { id: 'OP-02', label: 'GET /offers/{offerId}/seatmap', method: 'get', path: () => `/flights/v1/offers/${pickA.offerId}/seatmap?segmentId=${pickA.segmentId}`, expected: open, check: (r) => harness.validate('SeatMapResponse', r.body) },
      { id: 'OP-22', label: 'GET /flights/{flightNumber}/status', method: 'get', path: () => `/flights/v1/flights/${numberC}/status?date=${day(departureC)}`, expected: open, check: (r) => harness.validate('FlightStatus', r.body) },
      { id: 'OP-03', label: 'POST /offers/hold', method: 'post', path: () => '/flights/v1/offers/hold', body: () => holdBody(pickA), idempotent: true, expected: owned(201), check: (r) => harness.validate('HoldResponse', r.body) },
      { id: 'OP-04', label: 'GET /offers/hold/{holdId}', method: 'get', path: (c) => `/flights/v1/offers/hold/${c.holdRead}`, expected: owned(200), check: (r) => { harness.validate('HoldStatusResponse', r.body); expect(r.body.status).toBe('HELD'); } },
      { id: 'OP-05', label: 'DELETE /offers/hold/{holdId}', method: 'delete', path: (c) => `/flights/v1/offers/hold/${c.holdRead}`, expected: owned(204), check: (r) => expect(r.text).toBe('') },
      { id: 'OP-07', label: 'POST /bookings', method: 'post', path: () => '/flights/v1/bookings', body: (c) => bookingBody(c, c.holdBook, pickA), idempotent: true, expected: owned(201), check: (r) => { harness.validate('BookingDetail', r.body); expect(r.body.status).toBe('CONFIRMED'); } },
      { id: 'OP-06', label: 'GET /bookings', method: 'get', path: () => '/flights/v1/bookings', expected: owned(200), check: (r, c) => { harness.validate('BookingListResponse', r.body); expect(r.body.items.map((item: { bookingId: string }) => item.bookingId)).toContain(c.bookingId); } },
      { id: 'OP-08', label: 'GET /bookings/{bookingId}', method: 'get', path: (c) => `/flights/v1/bookings/${c.bookingId}`, expected: owned(200), check: (r, c) => { harness.validate('BookingDetail', r.body); expect(r.body.bookingId).toBe(c.bookingId); } },
      { id: 'OP-18', label: 'GET /bookings/{bookingId}/tickets', method: 'get', path: (c) => `/flights/v1/bookings/${c.bookingId}/tickets`, expected: owned(200), check: (r) => harness.validate('TicketListResponse', r.body) },
      { id: 'OP-19', label: 'GET /bookings/{bookingId}/tickets/{ticketId}', method: 'get', path: (c) => `/flights/v1/bookings/${c.bookingId}/tickets/${c.ticketId}`, expected: owned(200), check: (r, c) => { harness.validate('Ticket', r.body); expect(r.body.ticketId).toBe(c.ticketId); } },
      { id: 'OP-09', label: 'GET /bookings/{bookingId}/baggage-options', method: 'get', path: (c) => `/flights/v1/bookings/${c.bookingId}/baggage-options`, expected: owned(200), check: (r) => harness.validate('BaggageOptionsResponse', r.body) },
      { id: 'OP-10', label: 'POST /bookings/{bookingId}/baggage', method: 'post', path: (c) => `/flights/v1/bookings/${c.bookingId}/baggage`, body: (c) => ({ passengerId: c.passengerId, itineraryId: pickA.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` } }), idempotent: true, expected: owned(200), check: (r) => harness.validate('BaggageAddedResponse', r.body) },
      { id: 'OP-11', label: 'POST /bookings/{bookingId}/date-change/search', method: 'post', path: (c) => `/flights/v1/bookings/${c.bookingId}/date-change/search`, body: () => ({ changes: [{ itineraryId: pickA.itineraryId, newDepartureDate: day(departureB) }] }), expected: owned(200), check: (r, c) => { harness.validate('DateChangeSearchResponse', r.body); const found = r.body.find((offer: { segments: Array<{ flightNumber: string }> }) => offer.segments.some((segment) => segment.flightNumber === numberB)); expect(found).toBeTruthy(); c.changeOfferId = found.changeOfferId; } },
      { id: 'OP-12', label: 'POST /bookings/{bookingId}/date-change', method: 'post', path: (c) => `/flights/v1/bookings/${c.bookingId}/date-change`, body: (c) => ({ changeOfferId: c.changeOfferId, assignedSeats: [], payment: { paymentReference: `pay_ok_${randomUUID()}` } }), idempotent: true, expected: owned(200), check: (r) => harness.validate('BookingDetail', r.body) },
      { id: 'OP-13', label: 'GET /bookings/{bookingId}/cancellation-quote', method: 'get', path: (c) => `/flights/v1/bookings/${c.bookingId}/cancellation-quote`, expected: owned(200), check: (r, c) => { harness.validate('CancellationQuoteResponse', r.body); c.quoteId = r.body.quoteId; } },
      { id: 'OP-14', label: 'POST /bookings/{bookingId}/cancel', method: 'post', path: (c) => `/flights/v1/bookings/${c.bookingId}/cancel`, body: (c) => ({ quoteId: c.quoteId }), idempotent: true, expected: owned(200), check: (r) => expect(r.text).toBe('') },
      { id: 'OP-20', label: 'POST /bookings/{bookingId}/check-in', method: 'post', path: (c) => `/flights/v1/bookings/${c.checkInBookingId}/check-in`, expected: owned(200), check: (r, c) => { harness.validate('CheckInResponse', r.body); expect(r.body.checkedInPassengers).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId: c.passengerId, status: 'CHECKED_IN' })])); } },
      { id: 'OP-21', label: 'GET /bookings/{bookingId}/boarding-passes', method: 'get', path: (c) => `/flights/v1/bookings/${c.checkInBookingId}/boarding-passes`, expected: owned(200), check: (r) => harness.validate('BoardingPassListResponse', r.body) },
      { id: 'OP-16', label: 'POST /webhooks', method: 'post', path: () => '/flights/v1/webhooks', body: webhookBody, expected: partnerOrAdmin(201), check: (r, c) => { harness.validate('WebhookSubscription', r.body); expect(r.body.secret).toMatch(/^\*{4}/); c.webhookId = r.body.id; } },
      { id: 'OP-15', label: 'GET /webhooks', method: 'get', path: () => '/flights/v1/webhooks', expected: partnerOrAdmin(200), check: (r, c) => { items('WebhookSubscription')(r); expect(r.body.map((item: { id: string }) => item.id)).toContain(c.webhookId); } },
      { id: 'OP-17', label: 'DELETE /webhooks/{id}', method: 'delete', path: (c) => `/flights/v1/webhooks/${c.webhookId}`, expected: partnerOrAdmin(204), check: (r) => expect(r.text).toBe('') },
      { id: 'ADM-01', label: 'POST /admin/flights', method: 'post', path: () => '/flights/v1/admin/flights', body: adminFlightBody, expected: adminOnly(200), check: (r, c) => { c.adminFlightId = r.body.flightInstanceId; adminFlights.push(c.adminFlightId); expect(c.adminFlightId).toBeTruthy(); } },
      { id: 'ADM-02', label: 'GET /admin/flights', method: 'get', path: () => '/flights/v1/admin/flights?limit=1', expected: adminOnly(200), check: (r) => expect(Array.isArray(r.body.items)).toBe(true) },
      { id: 'ADM-03', label: 'PUT /admin/fares', method: 'put', path: () => '/flights/v1/admin/fares', body: (c) => fareBody(c.adminFlightId), expected: adminOnly(200), check: (r) => expect(r.body.fare).toBeTruthy() },
      { id: 'ADM-04', label: 'GET /admin/fares', method: 'get', path: (c) => `/flights/v1/admin/fares?flightInstanceId=${c.adminFlightId}`, expected: adminOnly(200), check: (r) => expect(Array.isArray(r.body.fares)).toBe(true) },
      { id: 'ADM-05', label: 'POST /admin/flights/{id}/operational-updates', method: 'post', path: (c) => `/flights/v1/admin/flights/${c.adminFlightId}/operational-updates`, body: () => ({ status: 'BOARDING' }), expected: adminOnly(200), check: (r) => harness.validate('FlightStatus', r.body) },
      { id: 'ADM-06', label: 'POST /admin/flights/{id}/close', method: 'post', path: (c) => `/flights/v1/admin/flights/${c.adminFlightId}/close`, expected: adminOnly(200), check: (r) => expect(r.body.closed).toBe(true) }
    ];

    // Un caso por celda: el nombre de cada `it` aparece en la salida --verbose.
    const cells = ops.flatMap((op) => roles.map((role) => [`${op.id} ${op.label} / ${role} ⇒ ${op.expected[role]}`, op, role] as const));
    it('la matriz cubre las 22 operaciones REST del contrato y las rutas admin', () => {
      expect(ops.filter((op) => op.id.startsWith('OP-')).map((op) => op.id).sort()).toEqual(Array.from({ length: 22 }, (_, index) => `OP-${String(index + 1).padStart(2, '0')}`));
      expect(ops.filter((op) => op.id.startsWith('ADM-'))).toHaveLength(6);
      expect(cells).toHaveLength(28 * 4);
    });

    // Fase 1: recurso ajeno ⇒ 404 (nunca 403) mientras los recursos del dueño existen.
    const foreign: Array<{ id: string; label: string; method: Method; path: (v: Ctx) => string; body?: (v: Ctx) => object; idempotent?: boolean; only?: Actor[] }> = [
      { id: 'OP-04', label: 'GET /offers/hold/{holdId}', method: 'get', path: (v) => `/flights/v1/offers/hold/${v.holdRead}` },
      { id: 'OP-05', label: 'DELETE /offers/hold/{holdId}', method: 'delete', path: (v) => `/flights/v1/offers/hold/${v.holdRead}` },
      { id: 'OP-07', label: 'POST /bookings con el hold ajeno', method: 'post', path: () => '/flights/v1/bookings', body: (v) => bookingBody(v, v.holdBook, pickA), idempotent: true },
      { id: 'OP-08', label: 'GET /bookings/{bookingId}', method: 'get', path: (v) => `/flights/v1/bookings/${v.bookingId}` },
      { id: 'OP-09', label: 'GET baggage-options', method: 'get', path: (v) => `/flights/v1/bookings/${v.bookingId}/baggage-options` },
      { id: 'OP-10', label: 'POST baggage', method: 'post', path: (v) => `/flights/v1/bookings/${v.bookingId}/baggage`, body: (v) => ({ passengerId: v.passengerId, itineraryId: pickA.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` } }), idempotent: true },
      { id: 'OP-11', label: 'POST date-change/search', method: 'post', path: (v) => `/flights/v1/bookings/${v.bookingId}/date-change/search`, body: () => ({ changes: [{ itineraryId: pickA.itineraryId, newDepartureDate: day(departureB) }] }) },
      { id: 'OP-12', label: 'POST date-change', method: 'post', path: (v) => `/flights/v1/bookings/${v.bookingId}/date-change`, body: () => ({ changeOfferId: randomUUID(), assignedSeats: [], payment: { paymentReference: `pay_ok_${randomUUID()}` } }), idempotent: true },
      { id: 'OP-13', label: 'GET cancellation-quote', method: 'get', path: (v) => `/flights/v1/bookings/${v.bookingId}/cancellation-quote` },
      { id: 'OP-14', label: 'POST cancel', method: 'post', path: (v) => `/flights/v1/bookings/${v.bookingId}/cancel`, body: () => ({ quoteId: randomUUID() }), idempotent: true },
      { id: 'OP-18', label: 'GET tickets', method: 'get', path: (v) => `/flights/v1/bookings/${v.bookingId}/tickets` },
      { id: 'OP-19', label: 'GET tickets/{ticketId}', method: 'get', path: (v) => `/flights/v1/bookings/${v.bookingId}/tickets/${v.ticketId}` },
      { id: 'OP-20', label: 'POST check-in', method: 'post', path: (v) => `/flights/v1/bookings/${v.checkInBookingId}/check-in` },
      { id: 'OP-21', label: 'GET boarding-passes', method: 'get', path: (v) => `/flights/v1/bookings/${v.checkInBookingId}/boarding-passes` },
      { id: 'OP-17', label: 'DELETE /webhooks/{id}', method: 'delete', path: (v) => `/flights/v1/webhooks/${v.webhookId}`, only: ['partner', 'admin'] }
    ];
    const foreignCells = foreign.flatMap((op) => actors.filter((actor) => !op.only || (op.only.includes(actor) && op.only.includes(victimOf[actor]))).map((actor) => [`${op.id} ${op.label} / ${actor} sobre recurso de ${victimOf[actor]} ⇒ 404`, op, actor] as const));
    it.each(foreignCells)('PLT-SEC-03 ajeno: %s', async (_title, op, actor) => {
      const victim = ctx[victimOf[actor]];
      const response = await send(actor, op.method, op.path(victim), op.body?.(victim), op.idempotent);
      expect(response.status).toBe(404); problem(response);
    });
    it('PLT-SEC-03 ajeno: ninguna petición ajena modificó el recurso del dueño', async () => {
      const { inventory, reservation, webhooks } = harness.dbs();
      for (const actor of actors) {
        const owner = ctx[actor];
        await expect(inventory.hold.findUnique({ where: { id: owner.holdRead } })).resolves.toMatchObject({ status: 'HELD', ownerId: owner.sub });
        await expect(inventory.hold.findUnique({ where: { id: owner.holdBook } })).resolves.toMatchObject({ status: 'HELD', ownerId: owner.sub });
        await expect(reservation.reservation.findUnique({ where: { id: owner.bookingId } })).resolves.toMatchObject({ status: 'CONFIRMED', ownerId: owner.sub });
        expect(await reservation.reservation.count({ where: { ownerId: { not: owner.sub }, holdId: { in: [owner.holdRead, owner.holdBook] } } })).toBe(0);
      }
      for (const actor of ['partner', 'admin'] as const) expect(await webhooks.subscription.count({ where: { id: ctx[actor].webhookId, ownerId: ctx[actor].sub } })).toBe(1);
    });

    // Fase 2: la matriz.
    it.each(cells)('PLT-SEC-03 matriz: %s', async (_title, op, role) => {
      const c = of(role);
      const response = await send(role, op.method, op.path(c), op.body?.(c), op.idempotent);
      expect(response.status).toBe(op.expected[role]);
      if (response.status >= 400) {
        problem(response);
        expect(response.body.code).toBe('VALIDATION_FAILED');
      } else op.check?.(response, c);
    }, 30_000);

    // El rol decide aunque el token traiga scopes de otro rol (GAP-018: 403 con VALIDATION_FAILED).
    const privileged = ops.filter((op) => op.id === 'OP-15' || op.id === 'OP-16' || op.id === 'OP-17' || op.id.startsWith('ADM-'));
    const forged = privileged.flatMap((op) => (['customer', 'partner'] as const).filter((actor) => op.expected[actor] === 403).map((actor) => [`${op.id} ${op.label} / ${actor} con scopes forjados ⇒ 403`, op, actor] as const));
    it.each(forged)('PLT-SEC-03 rol: %s', async (_title, op, actor) => {
      const c = ctx[actor];
      const response = await send(actor, op.method, op.path(c), op.body?.(c), op.idempotent, harness.token(scopesOf.admin, c.sub, actor));
      expect(response.status).toBe(403); problem(response);
    });

    describe('PLT-I7 / J7: seguridad', () => {
      it('PLT-I7 / J7: sin token ⇒ 401 con ProblemDetails', async () => {
        for (const [method, path, body, idempotent] of [['get', '/flights/v1/bookings'], ['post', '/flights/v1/offers/hold', holdBody(pickA), true], ['get', '/flights/v1/webhooks'], ['get', '/flights/v1/admin/flights']] as Array<[Method, string, object?, boolean?]>) {
          const response = await send('anonymous', method, path, body, idempotent);
          expect(response.status).toBe(401); problem(response); expect(response.body.code).toBe('VALIDATION_FAILED');
        }
      });
      it('PLT-I7 / J7: scope insuficiente ⇒ 403', async () => {
        const c = ctx.customer;
        for (const [method, path, scope, body, idempotent] of [
          ['post', '/flights/v1/offers/hold', 'flights:read flights:book', holdBody(pickA), true],
          ['post', '/flights/v1/bookings', 'flights:read flights:hold', bookingBody(c, c.holdBook, pickA), true],
          ['post', `/flights/v1/bookings/${c.bookingId}/cancel`, 'flights:read flights:book', { quoteId: randomUUID() }, true],
          ['get', `/flights/v1/bookings/${c.bookingId}`, 'flights:hold flights:book', undefined, false]
        ] as Array<[Method, string, string, object | undefined, boolean]>) {
          const response = await send('customer', method, path, body, idempotent, harness.token(scope, c.sub, 'customer'));
          expect(response.status).toBe(403); problem(response);
        }
        const partner = await send('partner', 'get', '/flights/v1/webhooks', undefined, false, harness.token('flights:read', ctx.partner.sub, 'partner'));
        expect(partner.status).toBe(403); problem(partner);
      });
      it('PLT-I7 / J7: recurso ajeno ⇒ 404 indistinguible de uno inexistente', async () => {
        const foreignResponse = await send('partner', 'get', `/flights/v1/bookings/${ctx.customer.bookingId}`);
        const missing = await send('partner', 'get', `/flights/v1/bookings/${randomUUID()}`);
        expect(foreignResponse.status).toBe(404); expect(missing.status).toBe(404); problem(foreignResponse);
        expect({ status: foreignResponse.body.status, code: foreignResponse.body.code, title: foreignResponse.body.title, detail: foreignResponse.body.detail }).toEqual({ status: missing.body.status, code: missing.body.code, title: missing.body.title, detail: missing.body.detail });
      });
      it('PLT-I7 / J7: 429 en /search con Retry-After al superar el límite por huella', async () => {
        // El arnés fija RATE_LIMIT_PUBLIC_PER_MIN=1; la huella es propia de este caso.
        const fingerprint = randomUUID();
        const call = () => request(harness.server()).post('/flights/v1/search').set('X-Device-Fingerprint', fingerprint).send(searchBody(day(departureA)));
        expect((await call()).status).toBe(200);
        const limited = await call();
        expect(limited.status).toBe(429); expect(limited.body.code).toBe('RATE_LIMIT_EXCEEDED'); problem(limited);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      });
      describe('CORS', () => {
        let cors: INestApplication | undefined;
        beforeAll(async () => {
          cors = await createGatewayApp(loadConfig({ NODE_ENV: 'test', INTERNAL_API_KEY: harness.internalKey, JWT_ISSUERS: JSON.stringify([{ iss: 'https://issuer.invalid/auth/v1', aud: 'authenticated', jwksUri: 'https://issuer.invalid/jwks.json' }]), CORS_ORIGINS: 'https://app.allowed.test', VALIDATE_RESPONSES: 'false', SCHEDULER_ENABLED: 'false' }));
        });
        afterAll(async () => { await cors?.close(); });
        it('PLT-I7 / J7: origen permitido ⇒ recibe Access-Control-Allow-Origin', async () => {
          const response = await request(cors!.getHttpServer()).get('/flights/v1/health').set('Origin', 'https://app.allowed.test');
          expect(response.status).toBe(200); expect(response.headers['access-control-allow-origin']).toBe('https://app.allowed.test');
          const preflight = await request(cors!.getHttpServer()).options('/flights/v1/bookings').set('Origin', 'https://app.allowed.test').set('Access-Control-Request-Method', 'GET');
          expect(preflight.status).toBe(204); expect(preflight.headers['access-control-allow-origin']).toBe('https://app.allowed.test');
        });
        it('PLT-I7 / J7: origen no permitido ⇒ sin cabeceras CORS', async () => {
          for (const origin of ['https://evil.test', 'https://app.allowed.test.evil.test']) {
            const response = await request(cors!.getHttpServer()).get('/flights/v1/health').set('Origin', origin);
            expect(response.status).toBe(200);
            expect(Object.keys(response.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
            const preflight = await request(cors!.getHttpServer()).options('/flights/v1/bookings').set('Origin', origin).set('Access-Control-Request-Method', 'GET');
            expect(Object.keys(preflight.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
          }
        });
      });
    });
  });
}
