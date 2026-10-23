import { createServer } from 'node:net';
import process from 'node:process';
import { join } from 'node:path';
import { generateKeyPairSync, randomInt, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';
import { parse } from 'yaml';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, type Observable } from 'rxjs';
import dotenv from 'dotenv';
import type { INestMicroservice } from '@nestjs/common';
import { createGrpcClient, SystemClock, withGrpcCallContext } from '@flight-platform/shared';
import { PrismaClient as InventoryPrisma } from '@prisma/client';
import { PrismaClient as PricingPrisma } from '../../../../microservices/pricing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as AncillariesPrisma } from '../../../../microservices/ancillaries-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as TicketingPrisma } from '../../../../microservices/ticketing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as WebhooksPrisma } from '../../../../microservices/webhooks-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as ReservationPrisma } from '../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as OperationsPrisma } from '../../../../microservices/operations-service/src/infrastructure/persistence/prisma-client/client';
import { createOperationsRuntime } from '../../../../microservices/operations-service/src/main';
import { createOperationsServer } from '../../../../microservices/operations-service/src/infrastructure/grpc/server';
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
type Name = 'inventory' | 'pricing' | 'ancillaries' | 'reservation' | 'ticketing' | 'webhooks' | 'operations';
// Ruta IATA propia de cada escenario: la búsqueda toma el primer vuelo del tramo y los restos de otras ejecuciones lo falsearían.
const randomRoute = () => { const code = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(0, 26))).join(''); const origin = code(); let destination = code(); if (destination === origin) destination = 'QQQ'; return { origin, destination }; };
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
  let webhooksDb: WebhooksPrisma;
  let ticketingDb: TicketingPrisma;
  let operationsDb: OperationsPrisma;
  let operationsRuntime: ReturnType<typeof createOperationsRuntime> | undefined;
  let reservationPricing: GrpcPricingGateway;
  let reservationTicketing: GrpcTicketingGateway;
  let gatewayLogs = '';
  let restoreGatewayOutput: (() => void) | undefined;
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
    for (const name of ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'webhooks', 'operations'] as Name[]) {
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
    webhooksDb = webhooks;
    const reservation = new ReservationPrisma({ datasources: { db: { url: database('reservation') } } }); databases.push(reservation);
    const operations = new OperationsPrisma({ datasources: { db: { url: database('operations') } } }); databases.push(operations); operationsDb = operations;
    reservationDb = reservation; ticketingDb = ticketing;
    await start(await createInventoryServer({ url: `127.0.0.1:${ports.inventory}`, internalApiKey: key, runtime: { prisma: inventory } }));
    await start(await createPricingServer({ url: `127.0.0.1:${ports.pricing}`, internalApiKey: key, runtime: { prisma: pricing, inventory: new PricingInventory(service('inventory') as never) } }));
    await start(await createAncillariesServer({ url: `127.0.0.1:${ports.ancillaries}`, internalApiKey: key, runtime: { prisma: ancillaries, pricing: new AncillariesPricing(service('pricing') as never) } }));
    await start(await createTicketingServer({ url: `127.0.0.1:${ports.ticketing}`, internalApiKey: key, prisma: ticketing }));
    await start(await createWebhooksServer({ url: `127.0.0.1:${ports.webhooks}`, internalApiKey: key, encryptionKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=', prisma: webhooks }));
    reservationPricing = new GrpcPricingGateway(factory('pricing'));
    reservationTicketing = new GrpcTicketingGateway(factory('ticketing'));
    const deps = composeReservation({ store: new PrismaReservationStore(reservation), pricing: reservationPricing, payment: new FakePaymentVerifier(), ancillaries: new GrpcAncillariesGateway(factory('ancillaries')), inventory: new GrpcInventoryGateway(factory('inventory')), ticketing: reservationTicketing, events: new GrpcEventPublisher(factory('webhooks')), operations: new PrismaBaggageOperations(reservation), quotes: new PrismaCancellationQuotes(reservation), clock: new SystemClock(), cutoffHours: 4, holdTtlMinutes: 20, validateResponse: createResponseValidator() });
    await start(await createReservationServer({ url: `127.0.0.1:${ports.reservation}`, internalApiKey: key, deps }));
    prior.set('GRPC_TLS', process.env.GRPC_TLS); process.env.GRPC_TLS = 'false';
    operationsRuntime = createOperationsRuntime(key, operations);
    await start(await createOperationsServer({ url: `127.0.0.1:${ports.operations}`, internalApiKey: key, runtime: operationsRuntime.runtime }));
    keyDir = mkdtempSync(join(tmpdir(), 'gateway-real-jwt-'));
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
    const publicKey = join(keyDir, 'public.pem');
    writeFileSync(publicKey, keys.publicKey);
    token = (scope, owner = 'gateway-real-owner') => `Bearer ${createDevToken(keys.privateKey, { sub: owner, app_role: 'customer', scope })}`;
    const output = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { gatewayLogs += chunk.toString(); return true; }) as typeof process.stdout.write);
    restoreGatewayOutput = () => output.mockRestore();
    gateway = await createGatewayApp(loadConfig({ NODE_ENV: 'test', INTERNAL_API_KEY: key, JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: publicKey }]), RATE_LIMIT_PUBLIC_PER_MIN: '1', VALIDATE_RESPONSES: 'true' }));
    await gateway.listen(0, '127.0.0.1');
  }, 120_000);

  afterAll(async () => {
    await gateway?.close();
    restoreGatewayOutput?.();
    operationsRuntime?.close();
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

  it('PLT-F: estado público, check-in y pases con autorización y contrato', async () => {
    const owner = `checkin-${randomUUID()}`; const flightId = randomUUID();
    const { origin, destination } = randomRoute();
    const flightNumber = `FP${randomInt(1000, 10000)}`;
    const aircraft = `T${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const departure = new Date(Date.now() + 36 * 3_600_000); const date = departure.toISOString().slice(0, 10);
    const offerIds: string[] = []; const server = gateway!.getHttpServer();
    try {
      await inventoryDb.flightInstance.create({ data: { id: flightId, flightNumber, departureIata: origin, arrivalIata: destination, departureAt: departure, arrivalAt: new Date(departure.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 3 } } } });
      await operationsDb.operationalFlight.create({ data: { flightInstanceId: flightId, flightNumber, date, marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: origin, arrivalIata: destination, scheduledDepartureAt: departure, scheduledArrivalAt: new Date(departure.getTime() + 3_600_000), aircraft, status: 'SCHEDULED' } });
      await pricingDb.fare.create({ data: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'CLASSIC', baseFareMinor: 10000, taxesMinor: 2000, rules: { changeable: true, refundable: true }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 } });
      await ancillariesDb.seatLayout.create({ data: { aircraft, cabinClass: 'ECONOMY', seatNumber: '1A', rowNumber: 1, characteristics: ['WINDOW'] } });
      const statusResponse = await request(server).get(`/flights/v1/flights/${flightNumber}/status`).query({ date }).set('X-Device-Fingerprint', randomUUID());
      expect(statusResponse.status).toBe(200); validate('FlightStatus', statusResponse.body); expect(statusResponse.body).toMatchObject({ flightNumber, date, status: 'SCHEDULED' });
      const missingStatus = await request(server).get('/flights/v1/flights/ZZ9999/status').query({ date }).set('X-Device-Fingerprint', randomUUID());
      expect(missingStatus.status).toBe(404); validate('ProblemDetails', missingStatus.body);
      const invalidStatus = await request(server).get(`/flights/v1/flights/${flightNumber}/status`).query({ date: 'bad-date' }).set('X-Device-Fingerprint', randomUUID());
      expect(invalidStatus.status).toBe(400); validate('ProblemDetails', invalidStatus.body);
      const search = await request(server).post('/flights/v1/search').set('X-Device-Fingerprint', randomUUID()).send({ itineraries: [{ origin: origin, destination: destination, departureDate: date }], passengers: { adults: 1 } });
      expect(search.status).toBe(200); validate('SearchResponse', search.body);
      offerIds.push(...search.body.offers.filter((item: { itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }) => item.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === flightNumber))).map((item: { offerId: string }) => item.offerId));
      const offer = search.body.offers.find((item: { itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }) => item.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === flightNumber)));
      expect(offer).toBeTruthy(); const itinerary = offer.itineraries.find((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((segment) => segment.flightNumber === flightNumber));
      const segment = itinerary.segments.find((item: { flightNumber: string }) => item.flightNumber === flightNumber);
      const option = itinerary.pricingOptions.find((item: { cabinClass: string; fareBrand: string }) => item.cabinClass === 'ECONOMY' && item.fareBrand === 'CLASSIC');
      const hold = await request(server).post('/flights/v1/offers/hold').set('Authorization', token('flights:hold', owner)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1 } });
      expect(hold.status).toBe(201); validate('HoldResponse', hold.body);
      const passengerId = randomUUID();
      const booking = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send({ holdId: hold.body.holdId, passengers: [{ passengerId, passengerType: 'ADULT', firstName: 'Test', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'TEST123', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'test@example.invalid', phone: '+593999999999' }, assignedSeats: [{ segmentId: segment.segmentId, seatNumber: '1A' }], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` } });
      expect(booking.status).toBe(201); validate('BookingDetail', booking.body);
      const path = `/flights/v1/bookings/${booking.body.bookingId}`;
      for (const route of [{ method: 'post', path: 'check-in', scope: 'flights:book' }, { method: 'get', path: 'boarding-passes', scope: 'flights:read' }] as const) {
        gatewayLogs = ''; const noScope = token('unrelated:scope', owner);
        const anonymous = await request(server)[route.method](`${path}/${route.path}`); expect(anonymous.status).toBe(401); validate('ProblemDetails', anonymous.body);
        const forbidden = await request(server)[route.method](`${path}/${route.path}`).set('Authorization', noScope); expect(forbidden.status).toBe(403); validate('ProblemDetails', forbidden.body);
        const other = await request(server)[route.method](`${path}/${route.path}`).set('Authorization', token(route.scope, `other-${randomUUID()}`)); expect(other.status).toBe(404); validate('ProblemDetails', other.body);
        const invalid = await request(server)[route.method](`/flights/v1/bookings/not-a-uuid/${route.path}`).set('Authorization', token(route.scope, owner)); expect(invalid.status).toBe(400); validate('ProblemDetails', invalid.body);
        expect(gatewayLogs).toContain('[REDACTED]'); expect(gatewayLogs).not.toContain(noScope.slice(7));
      }
      const checked = await request(server).post(`${path}/check-in`).set('Authorization', token('flights:book', owner));
      expect(checked.status).toBe(200); validate('CheckInResponse', checked.body); expect(checked.body.checkedInPassengers).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId, status: 'CHECKED_IN' })]));
      const passes = await request(server).get(`${path}/boarding-passes`).set('Authorization', token('flights:read', owner));
      expect(passes.status).toBe(200); validate('BoardingPassListResponse', passes.body); expect(passes.body.boardingPasses).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId, segmentId: segment.segmentId, seat: '1A' })]));
    } finally {
      const rows = await reservationDb.reservation.findMany({ where: { ownerId: owner }, select: { id: true } }); const ids = rows.map((row) => row.id);
      const holds = await inventoryDb.hold.findMany({ where: { ownerId: owner }, select: { id: true } }); const holdIds = holds.map((row) => row.id);
      await operationsDb.checkIn.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.baggageAllowance.deleteMany({ where: { ownerId: owner } }); await ancillariesDb.baggageItem.deleteMany({ where: { ownerId: owner } }); await ancillariesDb.seatAssignment.deleteMany({ where: { ownerId: owner } }); await ancillariesDb.bookingOwner.deleteMany({ where: { ownerId: owner } });
      await ticketingDb.issuanceRequest.deleteMany({ where: { bookingId: { in: ids } } }); await ticketingDb.ticket.deleteMany({ where: { ownerId: owner } }); await reservationDb.reservation.deleteMany({ where: { ownerId: owner } });
      await pricingDb.priceLock.deleteMany({ where: { ownerId: owner } }); await pricingDb.offer.deleteMany({ where: { id: { in: offerIds } } }); await inventoryDb.reservedInventory.deleteMany({ where: { ownerId: owner } }); await inventoryDb.hold.deleteMany({ where: { id: { in: holdIds } } });
      await pricingDb.fare.deleteMany({ where: { flightInstanceId: flightId } }); await ancillariesDb.seatLayout.deleteMany({ where: { aircraft } }); await operationsDb.operationalFlight.deleteMany({ where: { flightInstanceId: flightId } }); await inventoryDb.flightInstance.deleteMany({ where: { id: flightId } });
    }
  }, 60_000);

  const purchaseScenario = async (scenario: 'original' | 'foreign-hold' | 'changed-tickets' | 'cancelled-tickets') => {
    const flightId = randomUUID(); const changedFlightId = randomUUID(); const checkInFlightId = randomUUID(); const owner = `gateway-${randomUUID()}`;
    const startedAt = new Date();
    const { origin, destination } = randomRoute();
    const base = randomInt(1000, 9990); const numberA = `FP${base}`; const numberB = `FP${base + 1}`; const numberC = `FP${base + 2}`;
    const aircraft = `T${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const departure = new Date(Date.now() + 5 * 86_400_000); departure.setUTCHours(14, randomInt(0, 60), randomInt(0, 60), 0);
    const departureDate = departure.toISOString().slice(0, 10);
    const offerIds: string[] = []; const holdIds: string[] = [];
    const server = gateway!.getHttpServer();
    try {
      await webhooksDb.subscription.create({ data: { id: randomUUID(), ownerId: owner, url: 'https://example.test/post-sale', events: ['booking.baggage_added', 'booking.changed', 'booking.cancelled'], encryptedSecret: 'test', active: true } });
      await inventoryDb.flightInstance.create({ data: { id: flightId, flightNumber: numberA, departureIata: origin, arrivalIata: destination, departureAt: departure, arrivalAt: new Date(departure.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 9 } } } });
      const changedDeparture = new Date(departure.getTime() + 86_400_000);
      await inventoryDb.flightInstance.create({ data: { id: changedFlightId, flightNumber: numberB, departureIata: origin, arrivalIata: destination, departureAt: changedDeparture, arrivalAt: new Date(changedDeparture.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 9 } } } });
      const checkInDeparture = new Date(Date.now() + 36 * 3_600_000);
      await inventoryDb.flightInstance.create({ data: { id: checkInFlightId, flightNumber: numberC, departureIata: origin, arrivalIata: destination, departureAt: checkInDeparture, arrivalAt: new Date(checkInDeparture.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: 9 } } } });
      await operationsDb.operationalFlight.create({ data: { flightInstanceId: checkInFlightId, flightNumber: numberC, date: checkInDeparture.toISOString().slice(0, 10), marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: origin, arrivalIata: destination, scheduledDepartureAt: checkInDeparture, scheduledArrivalAt: new Date(checkInDeparture.getTime() + 3_600_000), aircraft, status: 'SCHEDULED' } });
      for (const id of [flightId, changedFlightId, checkInFlightId]) await pricingDb.fare.create({ data: { flightInstanceId: id, cabinClass: 'ECONOMY', brand: 'CLASSIC', baseFareMinor: 10000, taxesMinor: 2000, rules: { changeable: true, refundable: true }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 } });
      await ancillariesDb.seatLayout.create({ data: { aircraft, cabinClass: 'ECONOMY', seatNumber: '1A', rowNumber: 1, characteristics: ['WINDOW'] } });
      const search = await request(server).post('/flights/v1/search').set('X-Device-Fingerprint', randomUUID()).send({ itineraries: [{ origin: origin, destination: destination, departureDate }], passengers: { adults: 1 } });
      expect(search.status).toBe(200); validate('SearchResponse', search.body);
      offerIds.push(...search.body.offers.map((item: { offerId: string }) => item.offerId));
      const offer = search.body.offers.find((item: { itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }) => item.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === numberA)));
      expect(offer).toBeTruthy();
      const itinerary = offer.itineraries.find((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((segment) => segment.flightNumber === numberA));
      const segment = itinerary.segments.find((item: { flightNumber: string }) => item.flightNumber === numberA);
      const option = itinerary.pricingOptions.find((item: { cabinClass: string; fareBrand: string }) => item.cabinClass === 'ECONOMY' && item.fareBrand === 'CLASSIC');
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
      if (scenario === 'foreign-hold') {
        // OP-05 con el hold de otro sub: 404 del contrato y el hold sigue activo para su dueño.
        const foreignRelease = await request(server).delete(path).set('Authorization', token('flights:hold', `other-${randomUUID()}`));
        expect(foreignRelease.status).toBe(404); validate('ProblemDetails', foreignRelease.body);
        expect(foreignRelease.body.code).toBe(other.body.code);
        await expect(inventoryDb.hold.findUnique({ where: { id: hold.body.holdId } })).resolves.toMatchObject({ status: 'HELD', ownerId: owner });
        const stillHeld = await request(server).get(path).set('Authorization', token('flights:read', owner));
        expect(stillHeld.status).toBe(200); expect(stillHeld.body.status).toBe('HELD'); validate('HoldStatusResponse', stillHeld.body);
        return;
      }
      const released = await request(server).delete(path).set('Authorization', token('flights:hold', owner));
      expect(released.status).toBe(204); expect(released.text).toBe('');

      for (const paymentKind of ['ok', 'pending']) {
        const nextHold = await request(server).post('/flights/v1/offers/hold').set('Authorization', token('flights:hold', owner)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1 } });
        if (nextHold.body.holdId) holdIds.push(nextHold.body.holdId);
        expect(nextHold.status).toBe(201); validate('HoldResponse', nextHold.body);
        await expect(inventoryDb.hold.findUnique({ where: { id: nextHold.body.holdId } })).resolves.toMatchObject({ status: 'HELD', ownerId: owner });
        const foreignOwner = `other-${randomUUID()}`;
        const foreignPayload = { holdId: nextHold.body.holdId, passengers: [{ passengerId: randomUUID(), passengerType: 'ADULT', firstName: 'Test', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'TEST123', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'test@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` } };
        for (const code of [status.UNAVAILABLE, status.DEADLINE_EXCEEDED]) {
          const failure = jest.spyOn(reservationPricing, 'getHold').mockRejectedValueOnce(Object.assign(new Error('private dependency detail'), { code }));
          try {
            const unavailable = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send(foreignPayload);
            expect(unavailable.status).toBe(503); expect(unavailable.body.code).toBe('RATE_LIMIT_EXCEEDED'); expect(unavailable.headers['retry-after']).toBe('5'); validate('ProblemDetails', unavailable.body);
            expect(JSON.stringify(unavailable.body)).not.toContain('private dependency detail');
          } finally { failure.mockRestore(); }
        }
        const foreignBooking = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', foreignOwner)).set('Idempotency-Key', randomUUID()).send(foreignPayload);
        expect(foreignBooking.status).toBe(404); validate('ProblemDetails', foreignBooking.body);
        const missingBooking = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', foreignOwner)).set('Idempotency-Key', randomUUID()).send({ ...foreignPayload, holdId: randomUUID() });
        expect(missingBooking.status).toBe(404); validate('ProblemDetails', missingBooking.body); expect(missingBooking.body).toEqual(foreignBooking.body);
        expect(await reservationDb.reservation.count({ where: { ownerId: foreignOwner } })).toBe(0);
        await expect(inventoryDb.hold.findUnique({ where: { id: nextHold.body.holdId } })).resolves.toMatchObject({ status: 'HELD', ownerId: owner });
        const bookingPayload = { ...foreignPayload, payment: { paymentReference: `pay_${paymentKind}_${randomUUID()}` } };
        const bookingKey = randomUUID();
        if (paymentKind === 'ok') {
          const getHold = reservationPricing.getHold.bind(reservationPricing);
          const delayed = jest.spyOn(reservationPricing, 'getHold').mockImplementationOnce(async (input) => { await delay(300); return getHold(input); });
          const oldDeadline = process.env.GATEWAY_ORCHESTRATION_DEADLINE_MS;
          process.env.GATEWAY_ORCHESTRATION_DEADLINE_MS = '50';
          try {
            const timedOut = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', owner)).set('Idempotency-Key', bookingKey).send(bookingPayload);
            expect(timedOut.status).toBe(503); expect(timedOut.body.code).toBe('RATE_LIMIT_EXCEEDED'); expect(timedOut.headers['retry-after']).toBe('5'); validate('ProblemDetails', timedOut.body);
            const changed = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', owner)).set('Idempotency-Key', bookingKey).send({ ...bookingPayload, payment: { paymentReference: `pay_ok_${randomUUID()}` } });
            expect(changed.status).toBe(422); validate('ProblemDetails', changed.body);
          } finally { if (oldDeadline === undefined) delete process.env.GATEWAY_ORCHESTRATION_DEADLINE_MS; else process.env.GATEWAY_ORCHESTRATION_DEADLINE_MS = oldDeadline; delayed.mockRestore(); }
          let created = await reservationDb.reservation.findFirst({ where: { ownerId: owner, idempotencyKey: bookingKey } });
          for (let attempt = 0; attempt < 50 && created?.status !== 'CONFIRMED'; attempt++) { await delay(100); created = await reservationDb.reservation.findFirst({ where: { ownerId: owner, idempotencyKey: bookingKey } }); }
          expect(created?.status).toBe('CONFIRMED');
        }
        const booking = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', owner)).set('Idempotency-Key', bookingKey).send(bookingPayload);
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
        const foreignBookings = await request(server).get('/flights/v1/bookings').set('Authorization', token('flights:read', `other-${randomUUID()}`));
        expect(foreignBookings.status).toBe(200); validate('BookingListResponse', foreignBookings.body);
        expect(foreignBookings.body.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ bookingId: booking.body.bookingId })]));
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
          const paxId = bookingPayload.passengers[0].passengerId;
          const postSale = [
            { method: 'get', path: 'baggage-options', scope: 'flights:read', body: undefined },
            { method: 'post', path: 'baggage', scope: 'flights:book', body: { passengerId: paxId, itineraryId: itinerary.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` } } },
            { method: 'post', path: 'date-change/search', scope: 'flights:read', body: { changes: [{ itineraryId: itinerary.itineraryId, newDepartureDate: departureDate }] } },
            { method: 'post', path: 'date-change', scope: 'flights:book', body: { changeOfferId: randomUUID(), assignedSeats: [] } },
            { method: 'get', path: 'cancellation-quote', scope: 'flights:read', body: undefined },
            { method: 'post', path: 'cancel', scope: 'flights:cancel', body: { quoteId: randomUUID() } }
          ] as const;
          for (const route of postSale) {
            gatewayLogs = '';
            const insufficient = token('unrelated:scope', owner);
            const send = (bearer?: string) => {
              const call = request(server)[route.method](`${bookingPath}/${route.path}`).set('Idempotency-Key', randomUUID());
              if (bearer) call.set('Authorization', bearer);
              return route.body ? call.send(route.body) : call;
            };
            const anonymous = await send(); expect(anonymous.status).toBe(401); validate('ProblemDetails', anonymous.body);
            const forbidden = await send(insufficient); expect(forbidden.status).toBe(403); validate('ProblemDetails', forbidden.body);
            const other = await send(token(route.scope, `other-${randomUUID()}`)); expect(other.status).toBe(404); validate('ProblemDetails', other.body);
            const invalid = route.method === 'get'
              ? await request(server).get(`/flights/v1/bookings/not-a-uuid/${route.path}`).set('Authorization', token(route.scope, owner))
              : await request(server).post(`${bookingPath}/${route.path}`).set('Authorization', token(route.scope, owner)).set('Idempotency-Key', randomUUID()).send({});
            expect(invalid.status).toBe(400); validate('ProblemDetails', invalid.body);
            expect(gatewayLogs).toContain('[REDACTED]'); expect(gatewayLogs).not.toContain(insufficient.slice(7));
            if (route.path === 'baggage') expect(gatewayLogs).not.toContain(route.body.payment.paymentReference);
          }
          const baggageOptions = await request(server).get(`${bookingPath}/baggage-options`).set('Authorization', token('flights:read', owner));
          expect(baggageOptions.status).toBe(200); validate('BaggageOptionsResponse', baggageOptions.body);
          expect(baggageOptions.body).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId: paxId, itineraryId: itinerary.itineraryId })]));
          // ADR-F11-09: un pago pendiente o denegado nunca produce 200 ni deja maletas compradas.
          for (const prefix of ['pay_pending_', 'pay_denied_']) {
            const refused = await request(server).post(`${bookingPath}/baggage`).set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send({ passengerId: paxId, itineraryId: itinerary.itineraryId, quantity: 1, payment: { paymentReference: `${prefix}${randomUUID()}` } });
            expect(refused.status).toBe(422); expect(refused.body).toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' });
            validate('ProblemDetails', refused.body);
          }
          const afterRefused = await request(server).get(`${bookingPath}/baggage-options`).set('Authorization', token('flights:read', owner));
          expect(afterRefused.body).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId: paxId, itineraryId: itinerary.itineraryId, alreadyPurchased: 0 })]));
          const added = await request(server).post(`${bookingPath}/baggage`).set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send({ passengerId: paxId, itineraryId: itinerary.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` } });
          expect(added.status).toBe(200); validate('BaggageAddedResponse', added.body); expect(added.body).toMatchObject({ passengerId: paxId, itineraryId: itinerary.itineraryId, totalBaggage: 1 });
          const quote = await request(server).get(`${bookingPath}/cancellation-quote`).set('Authorization', token('flights:read', owner));
          expect(quote.status).toBe(200); validate('CancellationQuoteResponse', quote.body);
          const changes = await request(server).post(`${bookingPath}/date-change/search`).set('Authorization', token('flights:read', owner)).send({ changes: [{ itineraryId: itinerary.itineraryId, newDepartureDate: changedDeparture.toISOString().slice(0, 10) }] });
          expect(changes.status).toBe(200); validate('DateChangeSearchResponse', changes.body);
          const offerForChange = changes.body.find((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((item) => item.flightNumber === numberB));
          expect(offerForChange).toBeTruthy();
          const ticketsBefore = await request(server).get(`${bookingPath}/tickets`).set('Authorization', token('flights:read', owner));
          expect(ticketsBefore.status).toBe(200); validate('TicketListResponse', ticketsBefore.body);
          const idsBefore: string[] = ticketsBefore.body.tickets.filter((item: { status: string }) => item.status === 'ISSUED').map((item: { ticketId: string }) => item.ticketId);
          expect(idsBefore.length).toBeGreaterThan(0);
          const changed = await request(server).post(`${bookingPath}/date-change`).set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send({ changeOfferId: offerForChange.changeOfferId, assignedSeats: [], payment: { paymentReference: `pay_ok_${randomUUID()}` } });
          expect(changed.status).toBe(200); validate('BookingDetail', changed.body);
          expect(changed.body.itineraries.some((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((item) => item.flightNumber === numberB))).toBe(true);
          if (scenario === 'changed-tickets') {
            // J5 por REST (OP-17/18/19): detalle con el vuelo nuevo, tickets anteriores VOIDED y nuevos ISSUED.
            const changedDetail = await request(server).get(bookingPath).set('Authorization', token('flights:read', owner));
            expect(changedDetail.status).toBe(200); validate('BookingDetail', changedDetail.body);
            expect(changedDetail.body.status).toBe('CONFIRMED');
            expect(changedDetail.body.itineraries.some((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((item) => item.flightNumber === numberB))).toBe(true);
            const ticketsAfter = await request(server).get(`${bookingPath}/tickets`).set('Authorization', token('flights:read', owner));
            expect(ticketsAfter.status).toBe(200); validate('TicketListResponse', ticketsAfter.body);
            const byId = new Map<string, { status: string }>(ticketsAfter.body.tickets.map((item: { ticketId: string; status: string }) => [item.ticketId, item]));
            for (const id of idsBefore) expect(byId.get(id)?.status).toBe('VOIDED');
            const reissued = ticketsAfter.body.tickets.filter((item: { ticketId: string; status: string }) => !idsBefore.includes(item.ticketId) && item.status === 'ISSUED');
            expect(reissued.length).toBeGreaterThan(0);
            const reissuedOne = await request(server).get(`${bookingPath}/tickets/${reissued[0].ticketId}`).set('Authorization', token('flights:read', owner));
            expect(reissuedOne.status).toBe(200); validate('Ticket', reissuedOne.body); expect(reissuedOne.body.status).toBe('ISSUED');
            return;
          }
          const back = await request(server).post(`${bookingPath}/date-change/search`).set('Authorization', token('flights:read', owner)).send({ changes: [{ itineraryId: itinerary.itineraryId, newDepartureDate: departureDate }] });
          expect(back.status).toBe(200); validate('DateChangeSearchResponse', back.body);
          const backOffer = back.body.find((item: { segments: Array<{ flightNumber: string }> }) => item.segments.some((item) => item.flightNumber === numberA));
          expect(backOffer).toBeTruthy();
          const outage = jest.spyOn(reservationTicketing, 'reissueTickets').mockRejectedValueOnce(Object.assign(new Error('private outage'), { code: status.UNAVAILABLE }));
          try {
            const pending = await request(server).post(`${bookingPath}/date-change`).set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send({ changeOfferId: backOffer.changeOfferId, assignedSeats: [], payment: { paymentReference: `pay_ok_${randomUUID()}` } });
            expect(pending.status).toBe(202); expect(pending.text).toBe('');
          } finally { outage.mockRestore(); }
          const resume = service('reservation', owner, 'system') as { resumePending(input: object): Observable<unknown> };
          await firstValueFrom(resume.resumePending({ limit: 50 }));
          await expect(reservationDb.reservation.findUnique({ where: { id: booking.body.bookingId } })).resolves.toMatchObject({ status: 'CONFIRMED' });
          const finalQuote = await request(server).get(`${bookingPath}/cancellation-quote`).set('Authorization', token('flights:read', owner));
          expect(finalQuote.status).toBe(200); validate('CancellationQuoteResponse', finalQuote.body);
          const cancelled = await request(server).post(`${bookingPath}/cancel`).set('Authorization', token('flights:cancel', owner)).set('Idempotency-Key', randomUUID()).send({ quoteId: finalQuote.body.quoteId });
          expect(cancelled.status).toBe(200); expect(cancelled.text).toBe('');
          await expect(reservationDb.reservation.findUnique({ where: { id: booking.body.bookingId } })).resolves.toMatchObject({ status: 'CANCELLED' });
          if (scenario === 'cancelled-tickets') {
            // J5 por REST: reserva CANCELLED y tickets liquidados (REFUNDED o VOIDED), ninguno ISSUED.
            const cancelledDetail = await request(server).get(bookingPath).set('Authorization', token('flights:read', owner));
            expect(cancelledDetail.status).toBe(200); validate('BookingDetail', cancelledDetail.body); expect(cancelledDetail.body.status).toBe('CANCELLED');
            const cancelledTickets = await request(server).get(`${bookingPath}/tickets`).set('Authorization', token('flights:read', owner));
            expect(cancelledTickets.status).toBe(200); validate('TicketListResponse', cancelledTickets.body);
            expect(cancelledTickets.body.tickets.length).toBeGreaterThan(0);
            for (const item of cancelledTickets.body.tickets) expect(['REFUNDED', 'VOIDED']).toContain(item.status);
            return;
          }
          const deliveries = await webhooksDb.delivery.findMany({ where: { subscription: { ownerId: owner }, payload: { path: ['data', 'bookingId'], equals: booking.body.bookingId } } });
          expect(deliveries.map((delivery) => (delivery.payload as { eventType?: string }).eventType)).toEqual(expect.arrayContaining(['booking.baggage_added', 'booking.changed', 'booking.cancelled']));
          const secondHold = await request(server).post('/flights/v1/offers/hold').set('Authorization', token('flights:hold', owner)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1 } });
          expect(secondHold.status).toBe(201); validate('HoldResponse', secondHold.body); holdIds.push(secondHold.body.holdId);
          const secondBooking = await request(server).post('/flights/v1/bookings').set('Authorization', token('flights:book', owner)).set('Idempotency-Key', randomUUID()).send({ ...bookingPayload, holdId: secondHold.body.holdId, payment: { paymentReference: `pay_ok_${randomUUID()}` } });
          expect(secondBooking.status).toBe(201); validate('BookingDetail', secondBooking.body);
          const secondPath = `/flights/v1/bookings/${secondBooking.body.bookingId}`;
          const secondQuote = await request(server).get(`${secondPath}/cancellation-quote`).set('Authorization', token('flights:read', owner));
          expect(secondQuote.status).toBe(200); validate('CancellationQuoteResponse', secondQuote.body);
          const failedRefund = jest.spyOn(reservationTicketing, Number(secondQuote.body.refundAmount) > 0 ? 'refundTickets' : 'voidTickets').mockRejectedValueOnce(Object.assign(new Error('private outage'), { code: status.UNAVAILABLE }));
          try {
            const pendingCancel = await request(server).post(`${secondPath}/cancel`).set('Authorization', token('flights:cancel', owner)).set('Idempotency-Key', randomUUID()).send({ quoteId: secondQuote.body.quoteId });
            expect(pendingCancel.status).toBe(202); expect(pendingCancel.text).toBe('');
          } finally { failedRefund.mockRestore(); }
          await firstValueFrom(resume.resumePending({ limit: 50 }));
          await expect(reservationDb.reservation.findUnique({ where: { id: secondBooking.body.bookingId } })).resolves.toMatchObject({ status: 'CANCELLED' });
        }
      }
      const address = gateway!.getHttpServer().address() as { port: number };
      const smoke = await promisify(execFile)(process.execPath, [join(process.cwd(), 'platform/api-gateway/scripts/render-j1-smoke.cjs')], { env: { BASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_CUSTOMER_TOKEN: token('flights:read flights:hold flights:book', owner).slice(7), SMOKE_ORIGIN: origin, SMOKE_DESTINATION: destination, SMOKE_DEPARTURE_DATE: departureDate }, timeout: 30000 });
      expect(smoke.stdout.trim().split(/\r?\n/)).toEqual(['OK   sin token', 'OK   search', 'OK   seatmap', 'OK   hold', 'OK   booking', 'OK   detalle', 'OK   tickets']);
      const postSaleSmoke = await promisify(execFile)(process.execPath, [join(process.cwd(), 'platform/api-gateway/scripts/render-f11b-smoke.cjs')], { env: { BASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_CUSTOMER_TOKEN: token('flights:read flights:hold flights:book flights:cancel', owner).slice(7), SMOKE_ORIGIN: origin, SMOKE_DESTINATION: destination, SMOKE_POSTSALE_FLIGHT_NUMBER: numberA, SMOKE_CHECKIN_FLIGHT_NUMBER: numberC }, timeout: 60000 });
      expect(postSaleSmoke.stdout.trim().split(/\r?\n/)).toEqual(['OK   J5 búsqueda', 'OK   J5 hold', 'OK   J5 reserva', 'OK   J5 equipaje opciones', 'OK   J5 equipaje', 'OK   J5 buscar cambio', 'OK   J5 cambio', 'OK   J5 cotización', 'OK   J5 cancelación', 'OK   J6 búsqueda', 'OK   J6 mapa', 'OK   J6 hold', 'OK   J6 reserva', 'OK   J6 check-in', 'OK   J6 pases']);
    } finally {
      const ownerHolds = await inventoryDb.hold.findMany({ where: { ownerId: owner }, select: { id: true } });
      await webhooksDb.subscription.deleteMany({ where: { ownerId: owner } });
      holdIds.push(...ownerHolds.map((item) => item.id));
      const recentOffers = await pricingDb.offer.findMany({ where: { createdAt: { gte: startedAt } }, select: { id: true, snapshot: true } });
      offerIds.push(...recentOffers.filter((item) => [flightId, changedFlightId, checkInFlightId].some((id) => JSON.stringify(item.snapshot).includes(id))).map((item) => item.id));
      const bookings = await reservationDb.reservation.findMany({ where: { ownerId: owner }, select: { id: true } });
      const bookingIds = bookings.map((row) => row.id);
      await operationsDb.checkIn.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.baggageAllowance.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.baggageItem.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.seatAssignment.deleteMany({ where: { ownerId: owner } });
      await ancillariesDb.bookingOwner.deleteMany({ where: { ownerId: owner } });
      await ticketingDb.ticket.deleteMany({ where: { ownerId: owner } });
      await ticketingDb.issuanceRequest.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await reservationDb.reservation.deleteMany({ where: { ownerId: owner } });
      await pricingDb.changeOffer.deleteMany({ where: { ownerId: owner } });
      await pricingDb.priceLock.deleteMany({ where: { holdId: { in: holdIds } } });
      await inventoryDb.reservedInventory.deleteMany({ where: { holdId: { in: holdIds } } });
      await inventoryDb.hold.deleteMany({ where: { id: { in: holdIds } } });
      await pricingDb.offer.deleteMany({ where: { id: { in: offerIds } } });
      await pricingDb.fare.deleteMany({ where: { flightInstanceId: { in: [flightId, changedFlightId, checkInFlightId] } } });
      await ancillariesDb.seatLayout.deleteMany({ where: { aircraft } });
      await inventoryDb.flightInstance.deleteMany({ where: { id: flightId } });
      await inventoryDb.flightInstance.deleteMany({ where: { id: changedFlightId } });
      await operationsDb.operationalFlight.deleteMany({ where: { flightInstanceId: checkInFlightId } });
      await inventoryDb.flightInstance.deleteMany({ where: { id: checkInFlightId } });
    }
  };

  it('PLT-A/B e I5/I6: compra, postventa y smoke de check-in', () => purchaseScenario('original'), 120_000);
  it('OP-05 / S: liberar el hold de otro sub ? 404 y el hold sigue HELD para su due?o', () => purchaseScenario('foreign-hold'), 120_000);
  it('PLT-I5 / E: cambio de fecha anula los tickets anteriores y emite tickets nuevos', () => purchaseScenario('changed-tickets'), 120_000);
  it('PLT-I5 / E: cancelaci?n deja la reserva CANCELLED y los tickets liquidados', () => purchaseScenario('cancelled-tickets'), 120_000);

  it('OP-02: segmento sin ofertas activas devuelve 404 OFFER_NO_LONGER_AVAILABLE', async () => {
    const { origin, destination } = randomRoute(); const flightNumber = `FP${randomInt(1000, 10000)}`;
    const flightId = randomUUID(); const offerIds: string[] = [];
    const departure = new Date(Date.now() + 6 * 86_400_000); departure.setUTCHours(14, 0, 0, 0);
    const body = { itineraries: [{ origin: origin, destination: destination, departureDate: departure.toISOString().slice(0, 10) }], passengers: { adults: 1 } };
    const server = gateway!.getHttpServer();
    try {
      await inventoryDb.flightInstance.create({ data: { id: flightId, flightNumber: flightNumber, departureIata: origin, arrivalIata: destination, departureAt: departure, arrivalAt: new Date(departure.getTime() + 3_600_000), aircraft: 'TEST', cabins: { create: { cabinClass: 'ECONOMY', sellable: 9 } } } });
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
