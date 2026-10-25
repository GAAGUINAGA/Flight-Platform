/* global __filename */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { afterAll, beforeAll } from '@jest/globals';
import dotenv from 'dotenv';
import { INestMicroservice } from '@nestjs/common';
import { credentials, loadPackageDefinition, Metadata, ServiceError, status } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { createGrpcClient, SystemClock, withGrpcCallContext } from '@flight-platform/shared';
import { PrismaClient as InventoryPrisma } from '@prisma/client';
import { PrismaClient as PricingPrisma } from '../../../pricing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as AncillariesPrisma } from '../../../ancillaries-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as TicketingPrisma } from '../../../ticketing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as WebhooksPrisma } from '../../../webhooks-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as ReservationPrisma } from '../../../reservation-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as OperationsPrisma } from '../../src/infrastructure/persistence/prisma-client/client';
import { createInventoryServer } from '../../../inventory-service/src/infrastructure/grpc/server';
import { createPricingServer } from '../../../pricing-service/src/infrastructure/grpc/server';
import { createAncillariesServer } from '../../../ancillaries-service/src/infrastructure/grpc/server';
import { createTicketingServer } from '../../../ticketing-service/src/infrastructure/grpc/server';
import { createWebhooksServer } from '../../../webhooks-service/src/infrastructure/grpc/server';
import { createReservationServer } from '../../../reservation-service/src/infrastructure/grpc/server';
import { GrpcInventoryGateway as PricingInventory } from '../../../pricing-service/src/infrastructure/inventory/grpc-inventory.gateway';
import { GrpcPricingGateway as AncillariesPricing } from '../../../ancillaries-service/src/infrastructure/clients/grpc-gateways';
import { GrpcAncillariesGateway, GrpcEventPublisher, GrpcInventoryGateway, GrpcPricingGateway, GrpcServiceForOwner, GrpcTicketingGateway } from '../../../reservation-service/src/infrastructure/clients/grpc-gateways';
import { FakePaymentVerifier } from '../../../reservation-service/src/infrastructure/clients/fakes';
import { PrismaReservationStore } from '../../../reservation-service/src/infrastructure/persistence/prisma-reservation-store';
import { PrismaBaggageOperations } from '../../../reservation-service/src/infrastructure/persistence/prisma-baggage-operations';
import { PrismaCancellationQuotes } from '../../../reservation-service/src/infrastructure/persistence/prisma-cancellation-quotes';
import { composeReservation } from '../../../reservation-service/src/infrastructure/grpc/reservation-composition';
import { createResponseValidator } from '../../../reservation-service/src/infrastructure/grpc/openapi-response-validator';
import { createOperationsRuntime } from '../../src/main';
import { createOperationsServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const describeReal = process.env.RUN_DCS_REAL === 'true' ? describe : describe.skip;
const key = 'dcs-real-test-internal-key-at-least-32-bytes';
const ports = { inventory: 29951, pricing: 29952, ancillaries: 29953, reservation: 29954, ticketing: 29955, operations: 29956, webhooks: 29957 };
type RpcClient = Record<string, ((request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void)> & { close(): void };
type Offer = { offerId: string; itineraries: Array<{ itineraryId: string; segments: Array<{ flightInstanceId: string; segmentId: string; departure: { at: string } }>; pricingOptions: Array<{ cabinClass: string; fareBrand: string }> }> };
type Candidate = { offer: Offer; itinerary: Offer['itineraries'][number]; segment: Offer['itineraries'][number]['segments'][number]; fare: Offer['itineraries'][number]['pricingOptions'][number] };
const { findCandidate } = createRequire(__filename)('../../scripts/check-in-offers.cjs') as { findCandidate(search: (request: unknown) => Promise<{ offers: Offer[] }>, now: number, onSearch: (result: { offers: Offer[] }) => void): Promise<Candidate> };

describeReal('DCS-REAL: servicios y bases reales en el proceso de prueba', () => {
  let inventory: InventoryPrisma; let pricing: PricingPrisma; let ancillaries: AncillariesPrisma; let ticketing: TicketingPrisma; let webhooks: WebhooksPrisma; let reservation: ReservationPrisma; let operations: OperationsPrisma;
  const apps: INestMicroservice[] = [];
  const channels: Array<{ close(): void }> = [];
  let composition: ReturnType<typeof createOperationsRuntime>;
  const priorEnv = Object.fromEntries(['INVENTORY_GRPC_URL', 'WEBHOOKS_GRPC_URL', 'RESERVATION_GRPC_URL', 'TICKETING_GRPC_URL', 'ANCILLARIES_GRPC_URL', 'GRPC_TLS'].map((name) => [name, process.env[name]]));
  const root = findProtoRoot();
  const loadDatabase = (service: string): string => {
    const target: Record<string, string> = {};
    dotenv.config({ path: join(process.cwd(), 'microservices', service, '.env'), processEnv: target, quiet: true });
    if (!target.DATABASE_URL) throw new Error(`DCS-REAL requires DATABASE_URL for ${service}`);
    return target.DATABASE_URL;
  };
  const service = (name: keyof typeof ports, owner?: string, role = 'customer') => {
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    const options = { url: `127.0.0.1:${ports[name]}`, grpcTls: false, internalApiKey: key, correlationId: 'dcs-real', ownerId: owner, role, packageName: `flightplatform.${name}.v1`, protoPath: join(root, 'flightplatform', name, 'v1', `${name}.proto`), serviceName: `${title}Service` };
    const client = createGrpcClient(options); channels.push(client as unknown as { close(): void });
    return withGrpcCallContext(client.getService(options.serviceName), options);
  };
  const factory = (name: keyof typeof ports): GrpcServiceForOwner => (owner, role) => service(name, owner, role) as ReturnType<GrpcServiceForOwner>;
  const raw = (name: keyof typeof ports): RpcClient => {
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    const definition = loadSync(join(root, 'flightplatform', name, 'v1', `${name}.proto`), { includeDirs: [root], enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: Record<string, { v1: Record<string, new (address: string, creds: unknown) => RpcClient> }> };
    const client = new pkg.flightplatform[name].v1[`${title}Service`](`127.0.0.1:${ports[name]}`, credentials.createInsecure()); channels.push(client); return client;
  };
  const call = <T>(client: RpcClient, method: string, input: unknown, owner: string, role = 'customer') => new Promise<T>((resolve, reject) => { const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', owner); metadata.set('x-role', role); client[method](input, metadata, (error, result) => error ? reject(error) : resolve(result as T)); });
  const cleanup = async (owner: string, searchedOfferIds: string[]) => {
    if (!inventory || !pricing || !reservation || !ancillaries || !ticketing || !operations || !webhooks) return;
    const rows = await reservation.reservation.findMany({ where: { ownerId: owner }, select: { id: true } });
    const ids = rows.map((row) => row.id);
    const holds = await inventory.hold.findMany({ where: { ownerId: owner }, select: { id: true, status: true } });
    const holdIds = holds.map((row) => row.id);
    const locks = await pricing.priceLock.findMany({ where: { ownerId: owner }, select: { offerId: true } });
    const inventoryRpc = raw('inventory');
    for (const id of ids) await call(inventoryRpc, 'releaseReservedInventory', { bookingId: id, ownerId: owner }, owner, 'system');
    for (const hold of holds.filter((value) => value.status === 'HELD')) await call(inventoryRpc, 'releaseHold', { holdId: hold.id, ownerId: owner }, owner, 'system');
    await webhooks.subscription.deleteMany({ where: { ownerId: owner } });
    await operations.checkIn.deleteMany({ where: { ownerId: owner } });
    await ancillaries.baggageItem.deleteMany({ where: { ownerId: owner } });
    await ancillaries.baggageAllowance.deleteMany({ where: { ownerId: owner } });
    await ancillaries.seatAssignment.deleteMany({ where: { ownerId: owner } });
    await ancillaries.bookingOwner.deleteMany({ where: { ownerId: owner } });
    await ticketing.issuanceRequest.deleteMany({ where: { bookingId: { in: ids } } });
    await ticketing.ticket.deleteMany({ where: { ownerId: owner } });
    await reservation.reservation.deleteMany({ where: { ownerId: owner } });
    await pricing.priceLock.deleteMany({ where: { ownerId: owner } });
    const offerIds = [...new Set([...locks.map((row) => row.offerId), ...searchedOfferIds])];
    if (offerIds.length) await pricing.offer.deleteMany({ where: { id: { in: offerIds } } });
    await inventory.reservedInventory.deleteMany({ where: { ownerId: owner } });
    await inventory.hold.deleteMany({ where: { id: { in: holdIds } } });
  };

  beforeAll(async () => {
    inventory = new InventoryPrisma({ datasources: { db: { url: loadDatabase('inventory-service') } } });
    pricing = new PricingPrisma({ datasources: { db: { url: loadDatabase('pricing-service') } } });
    ancillaries = new AncillariesPrisma({ datasources: { db: { url: loadDatabase('ancillaries-service') } } });
    ticketing = new TicketingPrisma({ datasources: { db: { url: loadDatabase('ticketing-service') } } });
    webhooks = new WebhooksPrisma({ datasources: { db: { url: loadDatabase('webhooks-service') } } });
    reservation = new ReservationPrisma({ datasources: { db: { url: loadDatabase('reservation-service') } } });
    operations = new OperationsPrisma({ datasources: { db: { url: loadDatabase('operations-service') } } });
    const start = async (app: INestMicroservice) => { apps.push(app); await app.listen(); };
    await start(await createInventoryServer({ url: `127.0.0.1:${ports.inventory}`, internalApiKey: key, runtime: { prisma: inventory } }));
    await start(await createPricingServer({ url: `127.0.0.1:${ports.pricing}`, internalApiKey: key, runtime: { prisma: pricing, inventory: new PricingInventory(service('inventory') as never) } }));
    await start(await createAncillariesServer({ url: `127.0.0.1:${ports.ancillaries}`, internalApiKey: key, runtime: { prisma: ancillaries, pricing: new AncillariesPricing(service('pricing') as never) } }));
    await start(await createTicketingServer({ url: `127.0.0.1:${ports.ticketing}`, internalApiKey: key, prisma: ticketing }));
    await start(await createWebhooksServer({ url: `127.0.0.1:${ports.webhooks}`, internalApiKey: key, encryptionKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=', prisma: webhooks }));
    const store = new PrismaReservationStore(reservation);
    const deps = composeReservation({ store, pricing: new GrpcPricingGateway(factory('pricing')), payment: new FakePaymentVerifier(), ancillaries: new GrpcAncillariesGateway(factory('ancillaries')), inventory: new GrpcInventoryGateway(factory('inventory')), ticketing: new GrpcTicketingGateway(factory('ticketing')), events: new GrpcEventPublisher(factory('webhooks')), operations: new PrismaBaggageOperations(reservation), quotes: new PrismaCancellationQuotes(reservation), clock: new SystemClock(), cutoffHours: 4, holdTtlMinutes: 20, validateResponse: createResponseValidator() });
    await start(await createReservationServer({ url: `127.0.0.1:${ports.reservation}`, internalApiKey: key, deps }));
    for (const [name, value] of Object.entries({ INVENTORY_GRPC_URL: ports.inventory, WEBHOOKS_GRPC_URL: ports.webhooks, RESERVATION_GRPC_URL: ports.reservation, TICKETING_GRPC_URL: ports.ticketing, ANCILLARIES_GRPC_URL: ports.ancillaries })) process.env[name] = `127.0.0.1:${value}`;
    process.env.GRPC_TLS = 'false';
    composition = createOperationsRuntime(key, operations);
    await start(await createOperationsServer({ url: `127.0.0.1:${ports.operations}`, internalApiKey: key, runtime: composition.runtime }));
  }, 120_000);

  afterAll(async () => {
    composition?.close();
    for (const channel of channels) channel.close();
    await Promise.allSettled([...apps.reverse().map((app) => app.close()), operations?.$disconnect(), reservation?.$disconnect(), webhooks?.$disconnect(), ticketing?.$disconnect(), ancillaries?.$disconnect(), pricing?.$disconnect(), inventory?.$disconnect()]);
    for (const [name, value] of Object.entries(priorEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });

  it('DCS-01 / DCS-03 / DCS-05 / DCS-SEC-01: reserva propia, asiento real, pase e idempotencia', async () => {
    const owner = `dcs-${randomUUID()}`; const passenger = randomUUID(); const searchedOfferIds: string[] = [];
    try {
      const subscription = await webhooks.subscription.create({ data: { id: randomUUID(), ownerId: owner, url: 'https://example.invalid/dcs-test', events: ['booking.checked_in'], encryptedSecret: 'test-only', active: true } });
      const pricingRpc = raw('pricing'); const reservationRpc = raw('reservation'); const operationsRpc = raw('operations');
      const candidate = await findCandidate((request) => call<{ offers: Offer[] }>(pricingRpc, 'searchOffers', request, owner), Date.now(), (result) => searchedOfferIds.push(...result.offers.map((offer) => offer.offerId)));
      const { offer, itinerary, segment, fare } = candidate;
      const hold = await call<{ holdId: string }>(pricingRpc, 'holdOffer', { ownerId: owner, offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: fare.cabinClass, fareBrand: fare.fareBrand }], passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() }, owner);
      const booking = await call<{ bookingId: string; status: string }>(reservationRpc, 'createReservation', { holdId: hold.holdId, passengers: [{ passengerId: passenger, passengerType: 'ADULT', firstName: 'Real', lastName: 'Integration', documentType: 'PASSPORT', documentNumber: 'REAL12345', nationality: 'EC', documentExpiryDate: '2039-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'real@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }, owner);
      expect(booking.status).toBe('CONFIRMED');
      const first = await call(operationsRpc, 'checkIn', { bookingId: booking.bookingId }, owner);
      expect(first).toMatchObject({ bookingId: booking.bookingId, status: 'COMPLETED', checkedInPassengers: [expect.objectContaining({ passengerId: passenger, status: 'CHECKED_IN' })] });
      const assignment = await ancillaries.seatAssignment.findFirst({ where: { ownerId: owner, bookingId: booking.bookingId, passengerId: passenger, segmentId: segment.segmentId } });
      expect(assignment).toMatchObject({ status: 'CHECKED_IN', seatNumber: expect.stringMatching(/^[0-9]+[A-Z]$/) });
      expect(await webhooks.delivery.findMany({ where: { subscriptionId: subscription.id } })).toEqual([expect.objectContaining({ payload: expect.objectContaining({ eventType: 'booking.checked_in' }) })]);
      const passes = await call<{ boardingPasses: Array<{ passengerId: string; segmentId: string; barcode: string; barcodeType: string; seat: string }> }>(operationsRpc, 'listBoardingPasses', { bookingId: booking.bookingId }, owner);
      expect(passes.boardingPasses.find((value) => value.passengerId === passenger && value.segmentId === segment.segmentId)).toMatchObject({ seat: assignment?.seatNumber, barcodeType: 'QR', barcode: expect.stringMatching(/^M1\//) });
      expect(await call(operationsRpc, 'checkIn', { bookingId: booking.bookingId }, owner)).toEqual(first);
      expect(await operations.boardingPass.count({ where: { bookingId: booking.bookingId, ownerId: owner } })).toBe(1);
      expect(await webhooks.delivery.count({ where: { subscriptionId: subscription.id } })).toBe(1);
      await operations.boardingPass.deleteMany({ where: { bookingId: booking.bookingId, ownerId: owner } });
      await webhooks.delivery.deleteMany({ where: { subscriptionId: subscription.id } });
      await operations.checkIn.updateMany({ where: { bookingId: booking.bookingId, ownerId: owner }, data: { status: 'IN_PROGRESS', result: null, eventPublished: false, updatedAt: new Date(Date.now() - 11 * 60_000) } });
      await expect(call(operationsRpc, 'recoverCheckIns', { limit: 10 }, owner, 'customer')).rejects.toMatchObject({ code: status.PERMISSION_DENIED });
      expect(await call(operationsRpc, 'recoverCheckIns', { limit: 10 }, owner, 'system')).toMatchObject({ recoveredCheckIns: 1, publishedEvents: 0 });
      expect(await operations.boardingPass.count({ where: { bookingId: booking.bookingId, ownerId: owner } })).toBe(1);
      expect(await webhooks.delivery.count({ where: { subscriptionId: subscription.id } })).toBe(1);
      await webhooks.delivery.deleteMany({ where: { subscriptionId: subscription.id } });
      await operations.checkIn.updateMany({ where: { bookingId: booking.bookingId, ownerId: owner }, data: { eventPublished: false } });
      expect(await call(operationsRpc, 'recoverCheckIns', { limit: 10 }, owner, 'system')).toMatchObject({ recoveredCheckIns: 0, publishedEvents: 1 });
      expect(await webhooks.delivery.count({ where: { subscriptionId: subscription.id } })).toBe(1);
      await expect(call(operationsRpc, 'checkIn', { bookingId: booking.bookingId }, `other-${randomUUID()}`)).rejects.toMatchObject({ code: status.NOT_FOUND, details: 'NOT_FOUND' });
      await expect(call(operationsRpc, 'listBoardingPasses', { bookingId: booking.bookingId }, `other-${randomUUID()}`)).rejects.toMatchObject({ code: status.NOT_FOUND, details: 'NOT_FOUND' });
    } finally { await cleanup(owner, searchedOfferIds); }
  }, 120_000);

  it('DCS-SMOKE: el script completa todos sus pasos contra servicios reales', async () => {
    const owner = `dcs-smoke-test-${randomUUID()}`; const trace = join(tmpdir(), `dcs-smoke-${randomUUID()}.txt`);
    writeFileSync(trace, '');
    try {
      const result = await promisify(execFile)(process.execPath, [join(process.cwd(), 'microservices/operations-service/scripts/check-in-smoke.cjs')], { env: { ...process.env, INTERNAL_API_KEY: key, OPERATIONS_GRPC_URL: `127.0.0.1:${ports.operations}`, PRICING_GRPC_URL: `127.0.0.1:${ports.pricing}`, RESERVATION_GRPC_URL: `127.0.0.1:${ports.reservation}`, CHECKIN_SMOKE_OWNER_ID: owner, CHECKIN_SMOKE_TRACE_FILE: trace, GRPC_TLS: 'false' }, timeout: 120_000 }).catch((error: Error & { stdout?: string }) => { throw new Error(`DCS smoke failed:\n${error.stdout ?? ''}`); });
      expect(result.stdout.trim().split(/\r?\n/)).toEqual(['OK   Pricing.SearchOffers', 'OK   Pricing.HoldOffer', 'OK   Reservation.CreateReservation', 'OK   Operations.CheckIn', 'OK   Operations.ListBoardingPasses', 'OK   Operations.CheckInIdempotent', 'OK   Operations.OtherOwner', 'OK   Operations.WithoutKey']);
    } finally { try { await cleanup(owner, readFileSync(trace, 'utf8').split(/\r?\n/).filter(Boolean)); } finally { unlinkSync(trace); } }
  }, 150_000);
});
