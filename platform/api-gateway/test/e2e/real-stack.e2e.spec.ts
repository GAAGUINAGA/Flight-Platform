import { createServer } from 'node:net';
import process from 'node:process';
import { join } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import { parse } from 'yaml';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import dotenv from 'dotenv';
import type { INestMicroservice } from '@nestjs/common';
import { createGrpcClient, SystemClock, withGrpcCallContext } from '@flight-platform/shared';
import { PrismaClient as InventoryPrisma } from '@prisma/client';
import { PrismaClient as PricingPrisma } from '../../../../microservices/pricing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as AncillariesPrisma } from '../../../../microservices/ancillaries-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as TicketingPrisma } from '../../../../microservices/ticketing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as WebhooksPrisma } from '../../../../microservices/webhooks-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as ReservationPrisma } from '../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-client/client';
import { createInventoryServer } from '../../../../microservices/inventory-service/src/infrastructure/grpc/server';
import { createPricingServer, findProtoRoot } from '../../../../microservices/pricing-service/src/infrastructure/grpc/server';
import { createAncillariesServer } from '../../../../microservices/ancillaries-service/src/infrastructure/grpc/server';
import { createTicketingServer } from '../../../../microservices/ticketing-service/src/infrastructure/grpc/server';
import { createWebhooksServer } from '../../../../microservices/webhooks-service/src/infrastructure/grpc/server';
import { createReservationServer } from '../../../../microservices/reservation-service/src/infrastructure/grpc/server';
import { GrpcInventoryGateway as PricingInventory } from '../../../../microservices/pricing-service/src/infrastructure/inventory/grpc-inventory.gateway';
import { GrpcPricingGateway as AncillariesPricing } from '../../../../microservices/ancillaries-service/src/infrastructure/clients/grpc-gateways';
import { GrpcAncillariesGateway, GrpcEventPublisher, GrpcInventoryGateway, GrpcPricingGateway, GrpcServiceForOwner, GrpcTicketingGateway } from '../../../../microservices/reservation-service/src/infrastructure/clients/grpc-gateways';
import { FakePaymentVerifier } from '../../../../microservices/reservation-service/src/infrastructure/clients/fakes';
import { PrismaReservationStore } from '../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-reservation-store';
import { PrismaBaggageOperations } from '../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-baggage-operations';
import { PrismaCancellationQuotes } from '../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-cancellation-quotes';
import { composeReservation } from '../../../../microservices/reservation-service/src/infrastructure/grpc/reservation-composition';
import { createResponseValidator } from '../../../../microservices/reservation-service/src/infrastructure/grpc/openapi-response-validator';
import { callGatewayGrpc } from '../../src/grpc-clients';
import type { GatewayConfig } from '../../src/config';
import { loadConfig } from '../../src/config';
import { createGatewayApp } from '../../src/app';
import { createDevToken } from '../../../../infra/scripts/dev-token';
import { openApiSpecPath } from '../../src/openapi-path';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const key = 'gateway-real-internal-key-for-local-testing';
type Name = 'inventory' | 'pricing' | 'ancillaries' | 'reservation' | 'ticketing' | 'webhooks';
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') { server.close(); reject(new Error('No local port')); return; }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

describeReal('Gateway: composición gRPC real en proceso', () => {
  const apps: INestMicroservice[] = [];
  const channels: Array<{ close(): void }> = [];
  const databases: Array<{ $disconnect(): Promise<void> }> = [];
  const ports = {} as Record<Name, number>;
  const prior = new Map<string, string | undefined>();
  let gateway: INestApplication | undefined;
  let keyDir: string | undefined;
  let token: (scope: string, owner?: string) => string;
  let inventoryDb: InventoryPrisma;
  let pricingDb: PricingPrisma;
  let ancillariesDb: AncillariesPrisma;
  let reservationDb: ReservationPrisma;
  let ticketingDb: TicketingPrisma;
  const spec = parse(readFileSync(openApiSpecPath(), 'utf8')) as { components: { schemas: Record<string, object> } };
  const ajv = new Ajv({ strict: false });
  const validate = (schema: string, body: unknown) => {
    const check = ajv.compile({ ...spec.components.schemas[schema], components: spec.components });
    expect({ valid: check(body), errors: check.errors }).toEqual({ valid: true, errors: null });
  };
  const database = (name: Name) => {
    const values: Record<string, string> = {};
    dotenv.config({ path: join(process.cwd(), 'microservices', `${name}-service`, '.env'), processEnv: values, quiet: true });
    if (!values.DATABASE_URL) throw new Error(`DATABASE_URL is required for ${name}`);
    return values.DATABASE_URL;
  };
  const service = (name: Name, owner?: string, role = 'customer') => {
    const options = { url: `127.0.0.1:${ports[name]}`, grpcTls: false, internalApiKey: key, correlationId: 'gateway-real', ownerId: owner, role, packageName: `flightplatform.${name}.v1`, protoPath: join(findProtoRoot(), 'flightplatform', name, 'v1', `${name}.proto`), serviceName: `${name[0].toUpperCase()}${name.slice(1)}Service` };
    const client = createGrpcClient(options);
    channels.push(client as unknown as { close(): void });
    return withGrpcCallContext(client.getService(options.serviceName), options);
  };
  const factory = (name: Name): GrpcServiceForOwner => (owner, role) => service(name, owner, role) as ReturnType<GrpcServiceForOwner>;
  const start = async (app: INestMicroservice) => { apps.push(app); await app.listen(); };

  beforeAll(async () => {
    const allocated = new Set<number>();
    for (const name of ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'webhooks'] as Name[]) {
      do { ports[name] = await freePort(); } while (allocated.has(ports[name]));
      allocated.add(ports[name]);
      const variable = `${name.toUpperCase()}_GRPC_URL`;
      prior.set(variable, process.env[variable]);
      process.env[variable] = `127.0.0.1:${ports[name]}`;
    }
    const inventory = new InventoryPrisma({ datasources: { db: { url: database('inventory') } } }); databases.push(inventory);
    const pricing = new PricingPrisma({ datasources: { db: { url: database('pricing') } } }); databases.push(pricing);
    const ancillaries = new AncillariesPrisma({ datasources: { db: { url: database('ancillaries') } } }); databases.push(ancillaries);
    inventoryDb = inventory; pricingDb = pricing; ancillariesDb = ancillaries;
    const ticketing = new TicketingPrisma({ datasources: { db: { url: database('ticketing') } } }); databases.push(ticketing);
    const webhooks = new WebhooksPrisma({ datasources: { db: { url: database('webhooks') } } }); databases.push(webhooks);
    const reservation = new ReservationPrisma({ datasources: { db: { url: database('reservation') } } }); databases.push(reservation);
    reservationDb = reservation; ticketingDb = ticketing;
    await start(await createInventoryServer({ url: `127.0.0.1:${ports.inventory}`, internalApiKey: key, runtime: { prisma: inventory } }));
    await start(await createPricingServer({ url: `127.0.0.1:${ports.pricing}`, internalApiKey: key, runtime: { prisma: pricing, inventory: new PricingInventory(service('inventory') as never) } }));
    await start(await createAncillariesServer({ url: `127.0.0.1:${ports.ancillaries}`, internalApiKey: key, runtime: { prisma: ancillaries, pricing: new AncillariesPricing(service('pricing') as never) } }));
    await start(await createTicketingServer({ url: `127.0.0.1:${ports.ticketing}`, internalApiKey: key, prisma: ticketing }));
    await start(await createWebhooksServer({ url: `127.0.0.1:${ports.webhooks}`, internalApiKey: key, encryptionKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=', prisma: webhooks }));
    const deps = composeReservation({ store: new PrismaReservationStore(reservation), pricing: new GrpcPricingGateway(factory('pricing')), payment: new FakePaymentVerifier(), ancillaries: new GrpcAncillariesGateway(factory('ancillaries')), inventory: new GrpcInventoryGateway(factory('inventory')), ticketing: new GrpcTicketingGateway(factory('ticketing')), events: new GrpcEventPublisher(factory('webhooks')), operations: new PrismaBaggageOperations(reservation), quotes: new PrismaCancellationQuotes(reservation), clock: new SystemClock(), cutoffHours: 4, holdTtlMinutes: 20, validateResponse: createResponseValidator() });
    await start(await createReservationServer({ url: `127.0.0.1:${ports.reservation}`, internalApiKey: key, deps }));
    keyDir = mkdtempSync(join(tmpdir(), 'gateway-real-jwt-'));
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
    const publicKey = join(keyDir, 'public.pem');
    writeFileSync(publicKey, keys.publicKey);
    token = (scope, owner = 'gateway-real-owner') => `Bearer ${createDevToken(keys.privateKey, { sub: owner, app_role: 'customer', scope })}`;
    gateway = await createGatewayApp(loadConfig({ NODE_ENV: 'test', INTERNAL_API_KEY: key, JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: publicKey }]), RATE_LIMIT_PUBLIC_PER_MIN: '1', VALIDATE_RESPONSES: 'true' }));
    await gateway.listen(0, '127.0.0.1');
  }, 120_000);

  afterAll(async () => {
    await gateway?.close();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
    await Promise.allSettled(apps.reverse().map((app) => app.close()));
    await Promise.allSettled(channels.map(async (channel) => channel.close()));
    await Promise.allSettled(databases.map((db) => db.$disconnect()));
    for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });

  it('conecta el cliente real a Pricing y recibe rechazo de entrada inválida', async () => {
    const config = { internalApiKey: key, grpcTls: false } as GatewayConfig;
    await expect(callGatewayGrpc(config, 'pricing', 'searchOffers', { legs: [], passengers: { adults: 1 } }, 'gateway-real')).rejects.toMatchObject({ code: 3 });
  }, 30_000);
  it('protege las rutas REST de hold y valida las entradas', async () => {
    const server = gateway!.getHttpServer();
    const path = `/flights/v1/offers/hold/${randomUUID()}`;
    const anonymous = await request(server).get(path);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('VALIDATION_FAILED');
    validate('ProblemDetails', anonymous.body);
    const forbidden = await request(server).get(path).set('Authorization', token('flights:hold'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('VALIDATION_FAILED');
    validate('ProblemDetails', forbidden.body);
    const invalid = await request(server).post('/flights/v1/offers/hold').set('Authorization', token('flights:hold')).set('Idempotency-Key', randomUUID()).send({});
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
    validate('ProblemDetails', invalid.body);
    const releaseAnonymous = await request(server).delete(path);
    expect(releaseAnonymous.status).toBe(401); validate('ProblemDetails', releaseAnonymous.body);
    const releaseForbidden = await request(server).delete(path).set('Authorization', token('flights:read'));
    expect(releaseForbidden.status).toBe(403); validate('ProblemDetails', releaseForbidden.body);
  });

  it('protege las consultas de reservas y tickets con 401, 403 y 400', async () => {
    const server = gateway!.getHttpServer();
    const bookingId = randomUUID(); const ticketId = randomUUID();
    for (const path of ['/flights/v1/bookings', `/flights/v1/bookings/${bookingId}`, `/flights/v1/bookings/${bookingId}/tickets`, `/flights/v1/bookings/${bookingId}/tickets/${ticketId}`]) {
      const anonymous = await request(server).get(path);
      expect(anonymous.status).toBe(401); validate('ProblemDetails', anonymous.body);
      const forbidden = await request(server).get(path).set('Authorization', token('flights:hold'));
      expect(forbidden.status).toBe(403); validate('ProblemDetails', forbidden.body);
    }
    const invalid = await request(server).get('/flights/v1/bookings/not-a-uuid').set('Authorization', token('flights:read'));
    expect(invalid.status).toBe(400); validate('ProblemDetails', invalid.body);
    const payload = { holdId: randomUUID(), passengers: [], payment: { paymentReference: `pay_ok_${randomUUID()}` } };
    const anonymous = await request(server).post('/flights/v1/bookings').set('Idempotency-Key', randomUUID()).send(payload);
    expect(anonymous.status).toBe(401); validate('ProblemDetails', anonymous.body);
    const forbidden = await request(server).post('/flights/v1/bookings').set('Idempotency-Key', randomUUID()).set('Authorization', token('flights:read')).send(payload);
    expect(forbidden.status).toBe(403); validate('ProblemDetails', forbidden.body);
    const invalidBooking = await request(server).post('/flights/v1/bookings').set('Idempotency-Key', randomUUID()).set('Authorization', token('flights:book')).send({});
    expect(invalidBooking.status).toBe(400); validate('ProblemDetails', invalidBooking.body);
  });

  it('limita search por fingerprint con 429 y Retry-After', async () => {
    const server = gateway!.getHttpServer();
    const body = { itineraries: [{ origin: 'ZZZ', destination: 'YYY', departureDate: '2099-01-01' }], passengers: { adults: 1 } };
    const fingerprint = randomUUID();
    const first = await request(server).post('/flights/v1/search').set('X-Device-Fingerprint', fingerprint).send(body);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ totalOffers: 0, offers: [] });
    validate('SearchResponse', first.body);
    const limited = await request(server).post('/flights/v1/search').set('X-Device-Fingerprint', fingerprint).send(body);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMIT_EXCEEDED');
    validate('ProblemDetails', limited.body);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  }, 30_000);

  it('PLT-A/B: búsqueda, mapa y ciclo de hold aislado por propietario', async () => {
    const flightId = randomUUID(); const owner = `gateway-${randomUUID()}`;
    const startedAt = new Date();
    const aircraft = `T${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const departure = new Date(Date.now() + 5 * 86_400_000); departure.setUTCHours(14, 0, 0, 0);
    const departureDate = departure.toISOString().slice(0, 10);
    const offerIds: string[] = []; const holdIds: string[] = [];
    const server = gateway!.getHttpServer();
    try {
      await inventoryDb.flightInstance.create({ data: { id: flightId, flightNumber: 'FP991', departureIata: 'ZZZ', arrivalIata: 'YYY', departureAt: departure, arrivalAt: new Date(departure.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 9 } } } });
      await pricingDb.fare.create({ data: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 10000, taxesMinor: 2000, rules: { changeable: false, refundable: false }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 } });
      await ancillariesDb.seatLayout.create({ data: { aircraft, cabinClass: 'ECONOMY', seatNumber: '1A', rowNumber: 1, characteristics: ['WINDOW'] } });
      const search = await request(server).post('/flights/v1/search').set('X-Device-Fingerprint', randomUUID()).send({ itineraries: [{ origin: 'ZZZ', destination: 'YYY', departureDate }], passengers: { adults: 1 } });
      expect(search.status).toBe(200); validate('SearchResponse', search.body);
      offerIds.push(...search.body.offers.map((item: { offerId: string }) => item.offerId));
      const offer = search.body.offers.find((item: { itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }) => item.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === 'FP991')));
      expect(offer).toBeTruthy();
      const itinerary = offer.itineraries.find((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((segment) => segment.flightNumber === 'FP991'));
      const segment = itinerary.segments.find((item: { flightNumber: string }) => item.flightNumber === 'FP991');
      const option = itinerary.pricingOptions.find((item: { cabinClass: string; fareBrand: string }) => item.cabinClass === 'ECONOMY' && item.fareBrand === 'BASIC');
      expect(option.availableSeats).toBe(9);
      const seatmap = await request(server).get(`/flights/v1/offers/${offer.offerId}/seatmap`).query({ segmentId: segment.segmentId }).set('X-Device-Fingerprint', randomUUID());
      expect(seatmap.status).toBe(200); validate('SeatMapResponse', seatmap.body);
      expect(seatmap.body).toMatchObject({ segmentId: segment.segmentId, cabins: [{ cabinClass: 'ECONOMY', rows: [{ rowNumber: 1, seats: [{ seatNumber: '1A', isAvailable: true, characteristics: ['WINDOW'] }] }] }] });
      const missingMap = await request(server).get(`/flights/v1/offers/${offer.offerId}/seatmap`).query({ segmentId: randomUUID() }).set('X-Device-Fingerprint', randomUUID());
      expect(missingMap.status).toBe(404); expect(missingMap.body.code).toBe('OFFER_NO_LONGER_AVAILABLE'); validate('ProblemDetails', missingMap.body);
      const originalOffer = await pricingDb.offer.findUniqueOrThrow({ where: { id: offer.offerId } });
      await pricingDb.offer.update({ where: { id: offer.offerId }, data: { expiresAt: new Date(0) } });
      const expiredMap = await request(server).get(`/flights/v1/offers/${offer.offerId}/seatmap`).query({ segmentId: segment.segmentId }).set('X-Device-Fingerprint', randomUUID());
      expect(expiredMap.status).toBe(404); expect(expiredMap.body.code).toBe('OFFER_NO_LONGER_AVAILABLE'); validate('ProblemDetails', expiredMap.body);
      await pricingDb.offer.update({ where: { id: offer.offerId }, data: { expiresAt: originalOffer.expiresAt } });
      const hold = await request(server).post('/flights/v1/offers/hold').set('Authorization', token('flights:hold flights:read', owner)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1 } });
      if (hold.body.holdId) holdIds.push(hold.body.holdId);
      expect(hold.status).toBe(201); validate('HoldResponse', hold.body);
      const path = `/flights/v1/offers/hold/${hold.body.holdId}`;
      const other = await request(server).get(path).set('Authorization', token('flights:read', `other-${randomUUID()}`));
      expect(other.status).toBe(404); validate('ProblemDetails', other.body);
      const held = await request(server).get(path).set('Authorization', token('flights:read', owner));
      expect(held.status).toBe(200); expect(held.body.status).toBe('HELD'); validate('HoldStatusResponse', held.body);
      const released = await request(server).delete(path).set('Authorization', token('flights:hold', owner));
      expect(released.status).toBe(204); expect(released.text).toBe('');

      for (const paymentKind of ['ok', 'pending']) {
        const nextHold = await request(server).post('/flights/v1/offers/hold').set('Authorization', token('flights:hold', owner)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1 } });
        if (nextHold.body.holdId) holdIds.push(nextHold.body.holdId);
        expect(nextHold.status).toBe(201); validate('HoldResponse', nextHold.body);
        await expect(inventoryDb.hold.findUnique({ where: { id: nextHold.body.holdId } })).resolves.toMatchObject({ status: 'HELD', ownerId: owner });
        const booking = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send({ holdId: nextHold.body.holdId, passengers: [{ passengerId: randomUUID(), passengerType: 'ADULT', firstName: 'Test', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'TEST123', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'test@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_${paymentKind}_${randomUUID()}` } });
        expect(booking.status).toBe(paymentKind === 'ok' ? 201 : 202);
        validate('BookingDetail', booking.body);
        expect(booking.body.status).toBe(paymentKind === 'ok' ? 'CONFIRMED' : 'PENDING_PAYMENT');
        if (paymentKind === 'ok') {
          await expect(inventoryDb.hold.findUnique({ where: { id: nextHold.body.holdId } })).resolves.toMatchObject({ status: 'CONSUMED', ownerId: owner });
          await expect(reservationDb.reservation.findUnique({ where: { id: booking.body.bookingId } })).resolves.toMatchObject({ status: 'CONFIRMED', ownerId: owner, holdId: nextHold.body.holdId });
          expect(await ticketingDb.ticket.count({ where: { bookingId: booking.body.bookingId, ownerId: owner, status: 'ISSUED' } })).toBeGreaterThan(0);
        }
        const bookingPath = `/flights/v1/bookings/${booking.body.bookingId}`;
        const foreign = await request(server).get(bookingPath).set('Authorization', token('flights:read', `other-${randomUUID()}`));
        expect(foreign.status).toBe(404); validate('ProblemDetails', foreign.body);
        const detail = await request(server).get(bookingPath).set('Authorization', token('flights:read', owner));
        expect(detail.status).toBe(200); validate('BookingDetail', detail.body);
        const bookings = await request(server).get('/flights/v1/bookings').set('Authorization', token('flights:read', owner));
        expect(bookings.status).toBe(200); validate('BookingListResponse', bookings.body);
        expect(bookings.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ bookingId: booking.body.bookingId, status: booking.body.status })]));
        if (paymentKind === 'ok') {
          const list = await request(server).get(`${bookingPath}/tickets`).set('Authorization', token('flights:read', owner));
          expect(list.status).toBe(200); validate('TicketListResponse', list.body);
          expect(list.body.tickets).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'ISSUED' })]));
          const issued = list.body.tickets.find((item: { status: string }) => item.status === 'ISSUED');
          const foreignTickets = await request(server).get(`${bookingPath}/tickets`).set('Authorization', token('flights:read', `other-${randomUUID()}`));
          expect(foreignTickets.status).toBe(404); validate('ProblemDetails', foreignTickets.body);
          const foreignTicket = await request(server).get(`${bookingPath}/tickets/${issued.ticketId}`).set('Authorization', token('flights:read', `other-${randomUUID()}`));
          expect(foreignTicket.status).toBe(404); validate('ProblemDetails', foreignTicket.body);
          const ticket = await request(server).get(`${bookingPath}/tickets/${issued.ticketId}`).set('Authorization', token('flights:read', owner));
          expect(ticket.status).toBe(200); validate('Ticket', ticket.body); expect(ticket.body.ticketId).toBe(issued.ticketId);
        }
      }
      const address = gateway!.getHttpServer().address() as { port: number };
      const smoke = await promisify(execFile)(process.execPath, [join(process.cwd(), 'platform/api-gateway/scripts/render-j1-smoke.cjs')], { env: { BASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_CUSTOMER_TOKEN: token('flights:read flights:hold flights:book', owner).slice(7), SMOKE_ORIGIN: 'ZZZ', SMOKE_DESTINATION: 'YYY', SMOKE_DEPARTURE_DATE: departureDate }, timeout: 30000 });
      expect(smoke.stdout.trim().split(/\r?\n/)).toEqual(['OK   sin token', 'OK   search', 'OK   seatmap', 'OK   hold', 'OK   booking', 'OK   detalle', 'OK   tickets']);
    } finally {
      const ownerHolds = await inventoryDb.hold.findMany({ where: { ownerId: owner }, select: { id: true } });
      holdIds.push(...ownerHolds.map((item) => item.id));
      const recentOffers = await pricingDb.offer.findMany({ where: { createdAt: { gte: startedAt } }, select: { id: true, snapshot: true } });
      offerIds.push(...recentOffers.filter((item) => JSON.stringify(item.snapshot).includes(flightId)).map((item) => item.id));
      const bookings = await reservationDb.reservation.findMany({ where: { ownerId: owner }, select: { id: true } });
      const bookingIds = bookings.map((row) => row.id);
      await ancillariesDb.baggageAllowance.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.baggageItem.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.seatAssignment.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.bookingOwner.deleteMany({ where: { ownerId: owner } });
      await ticketingDb.ticket.deleteMany({ where: { ownerId: owner } });
      await ticketingDb.issuanceRequest.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await reservationDb.reservation.deleteMany({ where: { ownerId: owner } });
      await pricingDb.priceLock.deleteMany({ where: { holdId: { in: holdIds } } });
      await inventoryDb.reservedInventory.deleteMany({ where: { holdId: { in: holdIds } } });
      await inventoryDb.hold.deleteMany({ where: { id: { in: holdIds } } });
      await pricingDb.offer.deleteMany({ where: { id: { in: offerIds } } });
      await pricingDb.fare.deleteMany({ where: { flightInstanceId: flightId } });
      await ancillariesDb.seatLayout.deleteMany({ where: { aircraft } });
      await inventoryDb.flightInstance.deleteMany({ where: { id: flightId } });
    }
  }, 30_000);

  it('OP-02: segmento sin ofertas activas devuelve 404 OFFER_NO_LONGER_AVAILABLE', async () => {
    const flightId = randomUUID(); const offerIds: string[] = [];
    const departure = new Date(Date.now() + 6 * 86_400_000); departure.setUTCHours(14, 0, 0, 0);
    const body = { itineraries: [{ origin: 'ZZZ', destination: 'YYY', departureDate: departure.toISOString().slice(0, 10) }], passengers: { adults: 1 } };
    const server = gateway!.getHttpServer();
    try {
      await inventoryDb.flightInstance.create({ data: { id: flightId, flightNumber: 'FP992', departureIata: 'ZZZ', arrivalIata: 'YYY', departureAt: departure, arrivalAt: new Date(departure.getTime() + 3_600_000), aircraft: 'TEST', cabins: { create: { cabinClass: 'ECONOMY', sellable: 9 } } } });
      await pricingDb.fare.create({ data: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 10000, taxesMinor: 2000, rules: { changeable: false, refundable: false }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 } });
      const result = await request(server).post('/flights/v1/search').set('X-Device-Fingerprint', randomUUID()).send(body);
      expect(result.status).toBe(200); validate('SearchResponse', result.body);
      const found = result.body.offers.find((item: { itineraries: Array<{ segments: Array<{ segmentId: string }> }> }) => item.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.segmentId === flightId)));
      expect(found).toBeTruthy(); offerIds.push(found.offerId);
      await pricingDb.offer.update({ where: { id: found.offerId }, data: { expiresAt: new Date(0) } });
      const active = await pricingDb.offer.findMany({ where: { expiresAt: { gt: new Date() } }, select: { snapshot: true } });
      expect(active.some((item) => JSON.stringify(item.snapshot).includes(flightId))).toBe(false);
      const response = await request(server).get(`/flights/v1/offers/${found.offerId}/seatmap`).query({ segmentId: flightId }).set('X-Device-Fingerprint', randomUUID());
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('OFFER_NO_LONGER_AVAILABLE'); validate('ProblemDetails', response.body);
    } finally {
      await pricingDb.offer.deleteMany({ where: { id: { in: offerIds } } });
      await pricingDb.fare.deleteMany({ where: { flightInstanceId: flightId } });
      await inventoryDb.flightInstance.deleteMany({ where: { id: flightId } });
    }
  }, 30_000);
  it.todo('OP-02: oferta expirada con segmento compartido por otra oferta activa ⇒ 404 (requiere offerId en ResolveSegment; ver ADR-F11-03 y BACKLOG)');
});
