import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { INestMicroservice } from '@nestjs/common';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { createGrpcService } from '@flight-platform/shared';
import { CreateReservation } from '../../src/application/create-reservation';
import { ReservationQueries } from '../../src/application/queries';
import { ResumePending } from '../../src/application/resume-pending';
import { HoldDetails, PaymentResult, PaymentVerifier, PricingPort } from '../../src/application/ports';
import { PrismaReservationStore } from '../../src/infrastructure/persistence/prisma-reservation-store';
import { FakePaymentVerifier } from '../../src/infrastructure/clients/fakes';
import { GrpcAncillariesGateway, GrpcEventPublisher, GrpcInventoryGateway, GrpcPricingGateway, GrpcServiceForOwner, GrpcTicketingGateway } from '../../src/infrastructure/clients/grpc-gateways';
import { PrismaClient as ReservationPrisma } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as InventoryPrisma } from '@prisma/client';
import { PrismaClient as PricingPrisma } from '../../../pricing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as AncillariesPrisma } from '../../../ancillaries-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as TicketingPrisma } from '../../../ticketing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as WebhooksPrisma } from '../../../webhooks-service/src/infrastructure/persistence/prisma-client/client';
import { createInventoryServer } from '../../../inventory-service/src/infrastructure/grpc/server';
import { createPricingServer, findProtoRoot } from '../../../pricing-service/src/infrastructure/grpc/server';
import { createAncillariesServer } from '../../../ancillaries-service/src/infrastructure/grpc/server';
import { createTicketingServer } from '../../../ticketing-service/src/infrastructure/grpc/server';
import { createWebhooksServer } from '../../../webhooks-service/src/infrastructure/grpc/server';
import { createReservationServer } from '../../src/infrastructure/grpc/server';
import { GrpcInventoryGateway as PricingInventoryGateway } from '../../../pricing-service/src/infrastructure/inventory/grpc-inventory.gateway';
import { GrpcPricingGateway as AncillariesPricingGateway } from '../../../ancillaries-service/src/infrastructure/clients/grpc-gateways';
import { seed as seedInventory } from '../../../inventory-service/prisma/seed';
import { seed as seedPricing } from '../../../pricing-service/prisma/seed';
import { firstValueFrom } from 'rxjs';
import { PricingSearchResponse, selectOfferForHold } from './pricing-hold-fixture';

/**
 * RSV-12 is deliberately opt-in: it writes to all six local service schemas.
 * Run only in the principal checkout (never a clean clone):
 *   $env:RUN_RSV12_REAL='true'; npx jest microservices/reservation-service/test/integration/rsv-12-real.spec.ts --runInBand --verbose
 *
 * dotenv loads each local service .env into an isolated object. Values are never
 * copied to stdout/stderr. The test owns every Nest server and Prisma client and
 * closes them even if setup fails.
 */
const run = process.env.RUN_RSV12_REAL === 'true';
const describeReal = run ? describe : describe.skip;
const key = 'rsv-12-internal-key-that-is-at-least-32-bytes';
const ownerId = `rsv12-${randomUUID()}`;
const ports = { inventory: 29651, pricing: 29652, ancillaries: 29653, reservation: 29654, ticketing: 29655, webhooks: 29657 };

type ServiceEnv = Record<string, string>;
type PricingClient = { searchOffers(input: unknown): import('rxjs').Observable<PricingSearchResponse>; holdOffer(input: unknown): import('rxjs').Observable<{ holdId: string; expiresAt: string }>; };
type ReservationClient = { createReservation(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close(): void };

const loadEnv = (service: string): ServiceEnv => {
  const target: ServiceEnv = {};
  dotenv.config({ path: join(process.cwd(), 'microservices', service, '.env'), processEnv: target, override: false, quiet: true });
  if (!target.DATABASE_URL) throw new Error(`RSV-12 requires microservices/${service}/.env with DATABASE_URL`);
  return target;
};

describeReal('RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales', () => {
  let inventory: InventoryPrisma; let pricing: PricingPrisma; let ancillaries: AncillariesPrisma; let ticketing: TicketingPrisma; let webhooks: WebhooksPrisma; let reservation: ReservationPrisma;
  const apps: INestMicroservice[] = [];
  let store: PrismaReservationStore;
  let pricingClient: PricingClient;
  let factory: (url: string, packageName: string, proto: string, service: string) => GrpcServiceForOwner;
  const reservations: string[] = [];

  beforeAll(async () => {
    const env = Object.fromEntries(['inventory-service', 'pricing-service', 'ancillaries-service', 'ticketing-service', 'webhooks-service', 'reservation-service'].map((service) => [service, loadEnv(service)])) as Record<string, ServiceEnv>;
    inventory = new InventoryPrisma({ datasources: { db: { url: env['inventory-service'].DATABASE_URL } } });
    pricing = new PricingPrisma({ datasources: { db: { url: env['pricing-service'].DATABASE_URL } } });
    ancillaries = new AncillariesPrisma({ datasources: { db: { url: env['ancillaries-service'].DATABASE_URL } } });
    ticketing = new TicketingPrisma({ datasources: { db: { url: env['ticketing-service'].DATABASE_URL } } });
    webhooks = new WebhooksPrisma({ datasources: { db: { url: env['webhooks-service'].DATABASE_URL } } });
    reservation = new ReservationPrisma({ datasources: { db: { url: env['reservation-service'].DATABASE_URL } } });
    await Promise.all([seedInventory(inventory), seedPricing(pricing)]);
    const root = findProtoRoot();
    factory = (url: string, packageName: string, proto: string, service: string): GrpcServiceForOwner => (owner, role) => createGrpcService({ url, grpcTls: false, internalApiKey: key, correlationId: 'rsv-12', ownerId: owner, role, packageName, protoPath: join(root, ...proto.split('/')), serviceName: service });
    const inventoryApp = await createInventoryServer({ url: `127.0.0.1:${ports.inventory}`, internalApiKey: key, runtime: { prisma: inventory } }); apps.push(inventoryApp); await inventoryApp.listen();
    const pricingInventory = new PricingInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService')(ownerId, 'system') as never);
    const pricingApp = await createPricingServer({ url: `127.0.0.1:${ports.pricing}`, internalApiKey: key, runtime: { prisma: pricing, inventory: pricingInventory } }); apps.push(pricingApp); await pricingApp.listen();
    const ancillariesPricing = new AncillariesPricingGateway(factory(`127.0.0.1:${ports.pricing}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService')(ownerId, 'system') as never);
    const ancillariesApp = await createAncillariesServer({ url: `127.0.0.1:${ports.ancillaries}`, internalApiKey: key, runtime: { prisma: ancillaries, pricing: ancillariesPricing } }); apps.push(ancillariesApp); await ancillariesApp.listen();
    const ticketingApp = await createTicketingServer({ url: `127.0.0.1:${ports.ticketing}`, internalApiKey: key, prisma: ticketing }); apps.push(ticketingApp); await ticketingApp.listen();
    const webhooksApp = await createWebhooksServer({ url: `127.0.0.1:${ports.webhooks}`, internalApiKey: key, encryptionKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=', prisma: webhooks }); apps.push(webhooksApp); await webhooksApp.listen();
    pricingClient = factory(`127.0.0.1:${ports.pricing}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService')(ownerId, 'customer') as PricingClient;
    store = new PrismaReservationStore(reservation);
  }, 120_000);

  afterAll(async () => {
    try { if (reservation && reservations.length) await reservation.reservation.deleteMany({ where: { id: { in: reservations } } }); }
    finally { await Promise.allSettled([...apps.reverse().map((app) => app.close()), reservation?.$disconnect(), webhooks?.$disconnect(), ticketing?.$disconnect(), ancillaries?.$disconnect(), pricing?.$disconnect(), inventory?.$disconnect()]); }
  });

  const passenger = (segmentId: string, seatNumber: string) => ({ passengerId: randomUUID(), passengerType: 'ADULT', firstName: 'Real', lastName: 'Integration', documentType: 'PASSPORT', documentNumber: 'REAL12345', nationality: 'EC', documentExpiryDate: '2030-01-01', birthDate: '1990-01-01', gender: 'M', contact: { email: 'real@example.test', phone: '+593999999999' }, assignedSeats: [{ segmentId, seatNumber }], extraBaggage: [] });
  const fields = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).join(', ') : '(no es objeto)';
  const itinerarySnapshot = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`el price lock no trae un snapshot de oferta; campos: ${fields(value)}`);
    const offer = (value as { offer?: unknown }).offer;
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new Error(`el price lock no trae offer; campos: ${fields(value)}`);
    const itineraries = (offer as { itineraries?: unknown }).itineraries;
    if (!Array.isArray(itineraries) || itineraries.length === 0) throw new Error(`la respuesta de hold no trae itineraries; campos: ${fields(offer)}`);
    const first = itineraries[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) throw new Error('el primer itinerario del hold no es un objeto');
    const segments = (first as { segments?: unknown }).segments;
    if (!Array.isArray(segments) || segments.length === 0) throw new Error(`el primer itinerario del hold no trae segments; campos: ${fields(first)}`);
    const segment = segments[0];
    if (!segment || typeof segment !== 'object' || typeof (segment as { segmentId?: unknown }).segmentId !== 'string') throw new Error(`el primer segmento del hold no trae segmentId; campos: ${fields(segment)}`);
    return { itineraries: itineraries as HoldDetails['itineraries'], segmentId: (segment as { segmentId: string }).segmentId };
  };
  const availableSeat = async (segmentId: string) => {
    const [layout, assignments] = await Promise.all([
      ancillaries.seatLayout.findMany({ where: { cabinClass: 'ECONOMY' }, select: { seatNumber: true }, orderBy: { seatNumber: 'asc' } }),
      ancillaries.seatAssignment.findMany({ where: { segmentId, status: { not: 'RELEASED' } }, select: { seatNumber: true } })
    ]);
    const occupied = new Set(assignments.map((assignment) => assignment.seatNumber));
    const seat = layout.find((item) => !occupied.has(item.seatNumber))?.seatNumber;
    if (!seat) throw new Error('no hay asiento ECONOMY libre para el escenario RSV-12');
    return seat;
  };
  const hold = async (expired = false) => {
    const date = new Date(Date.now() + 172800000).toISOString().slice(0, 10);
    const search = await firstValueFrom(pricingClient.searchOffers({ legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }));
    const offer = selectOfferForHold(search);
    const response = await firstValueFrom(pricingClient.holdOffer({ ownerId, offerId: offer.offerId, itinerarySelections: offer.itinerarySelections, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() }));
    if (!response.holdId) throw new Error(`la respuesta de hold no trae holdId; campos: ${fields(response)}`);
    if (expired) await inventory.hold.update({ where: { id: response.holdId }, data: { expiresAt: new Date(0) } });
    const lock = await pricing.priceLock.findUnique({ where: { holdId: response.holdId } });
    if (!lock) throw new Error('el hold creado no tiene price lock persistido');
    const snapshot = itinerarySnapshot(lock.fareSnapshot);
    const grpcPricing = new GrpcPricingGateway(factory(`127.0.0.1:${ports.pricing}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
    const pricingPort: PricingPort = {
      getHold: async (): Promise<HoldDetails> => {
        const mapped = await grpcPricing.getHold({ holdId: response.holdId, ownerId });
        return { ...mapped, status: expired ? 'EXPIRED' : mapped.status, expiresAt: expired ? new Date(0).toISOString() : response.expiresAt, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: snapshot.itineraries };
      }
    };
    return { holdId: response.holdId, segmentId: snapshot.segmentId, seatNumber: await availableSeat(snapshot.segmentId), pricingPort };
  };
  const services = (pricingPort: PricingPort, payment: PaymentVerifier = new FakePaymentVerifier(), ticketingPort = new GrpcTicketingGateway(factory(`127.0.0.1:${ports.ticketing}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'))) => { const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService')); const inventoryPort = new GrpcInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService')); const events = new GrpcEventPublisher(factory(`127.0.0.1:${ports.webhooks}`, 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService')); const useCase = new CreateReservation(store, pricingPort, payment, ancillary, inventoryPort, ticketingPort, events); return { useCase, resume: new ResumePending(store, payment, events, ancillary, inventoryPort, ticketingPort) }; };
  it('RSV-12 / I: ruta feliz emite tickets con los cinco servicios reales', async () => { const fixture = await hold(); await webhooks.subscription.create({ data: { id: randomUUID(), ownerId, url: 'https://example.test/hook', events: ['booking.confirmed'], encryptedSecret: 'test', active: true } }); const created = await services(fixture.pricingPort).useCase.execute({ ownerId, holdId: fixture.holdId, passengers: [passenger(fixture.segmentId, fixture.seatNumber)], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }); reservations.push(created.id); await expect(ticketing.ticket.findMany({ where: { bookingId: created.id } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'ISSUED' })])); await expect(ancillaries.seatAssignment.findFirst({ where: { bookingId: created.id } })).resolves.toMatchObject({ status: 'CONFIRMED' }); await expect(inventory.hold.findUnique({ where: { id: fixture.holdId } })).resolves.toMatchObject({ status: 'CONSUMED' }); await expect(inventory.cabinInventory.findFirst({ where: { sold: { gt: 0 } } })).resolves.toBeTruthy(); await expect(webhooks.delivery.findFirst({ where: { payload: { path: ['data', 'bookingId'], equals: created.id } } })).resolves.toBeTruthy(); });
  it('RSV-12 / I: pago pendiente pasa por ResumePending hasta CONFIRMED', async () => { const fixture = await hold(); let authorized = false; const payment: PaymentVerifier = { verify: async (): Promise<PaymentResult> => authorized ? 'AUTHORIZED' : 'PENDING', void: async () => undefined }; const flow = services(fixture.pricingPort, payment); const created = await flow.useCase.execute({ ownerId, holdId: fixture.holdId, passengers: [passenger(fixture.segmentId, fixture.seatNumber)], payment: { paymentReference: `pay_pending_${randomUUID()}` }, idempotencyKey: randomUUID() }); reservations.push(created.id); expect(created.status).toBe('PENDING_PAYMENT'); authorized = true; await flow.resume.execute({ limit: 50 }); await expect(reservation.reservation.findUnique({ where: { id: created.id } })).resolves.toMatchObject({ status: 'CONFIRMED' }); await expect(ticketing.ticket.findFirst({ where: { bookingId: created.id } })).resolves.toMatchObject({ status: 'ISSUED' }); });
  it('RSV-12 / I: TICKETING_FAIL_MODE=always libera recursos', async () => { const fixture = await hold(); const line = await inventory.holdLine.findFirstOrThrow({ where: { holdId: fixture.holdId } }); const before = await inventory.cabinInventory.findUniqueOrThrow({ where: { flightInstanceId_cabinClass: { flightInstanceId: line.flightInstanceId, cabinClass: line.cabinClass } } }); const port = 29656; const failingApp = await createTicketingServer({ url: `127.0.0.1:${port}`, internalApiKey: key, prisma: ticketing, config: { failMode: 'always' } }); await failingApp.listen(); try { const failing = new GrpcTicketingGateway(factory(`127.0.0.1:${port}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService')); const flow = services(fixture.pricingPort, new FakePaymentVerifier(), failing); const input = { ownerId, holdId: fixture.holdId, passengers: [passenger(fixture.segmentId, fixture.seatNumber)], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }; await expect(flow.useCase.execute(input)).rejects.toThrow('TICKET_ISSUANCE_FAILED'); const row = await reservation.reservation.findFirstOrThrow({ where: { ownerId, idempotencyKey: input.idempotencyKey } }); reservations.push(row.id); await flow.resume.execute({}); await flow.resume.execute({}); await flow.resume.execute({}); await expect(reservation.reservation.findUnique({ where: { id: row.id } })).resolves.toMatchObject({ status: 'FAILED' }); await expect(ticketing.ticket.findMany({ where: { bookingId: row.id } })).resolves.toEqual(expect.not.arrayContaining([expect.objectContaining({ status: 'ISSUED' })])); await expect(ancillaries.seatAssignment.findFirst({ where: { bookingId: row.id } })).resolves.toMatchObject({ status: 'RELEASED' }); await expect(inventory.reservedInventory.findFirst({ where: { reservationId: row.id } })).resolves.toMatchObject({ releasedAt: expect.any(Date) }); await expect(inventory.cabinInventory.findUnique({ where: { flightInstanceId_cabinClass: { flightInstanceId: line.flightInstanceId, cabinClass: line.cabinClass } } })).resolves.toMatchObject({ sold: before.sold }); } finally { await failingApp.close(); } });
  it('RSV-12 / I: hold expirado se rechaza sin crear reserva', async () => { const fixture = await hold(true); const keyId = randomUUID(); await expect(services(fixture.pricingPort).useCase.execute({ ownerId, holdId: fixture.holdId, passengers: [passenger(fixture.segmentId, fixture.seatNumber)], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: keyId })).rejects.toMatchObject({ message: 'OFFER_NO_LONGER_AVAILABLE' }); await expect(reservation.reservation.count({ where: { ownerId, idempotencyKey: keyId } })).resolves.toBe(0); });
  it('RSV-12 / I: CreateReservation por gRPC usa los adaptadores reales como main con owner smoke no UUID', async () => {
    const smokeOwner = `smoke-${randomUUID()}`;
    const date = new Date(Date.now() + 172800000).toISOString().slice(0, 10);
    const search = await firstValueFrom(pricingClient.searchOffers({ legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }));
    const offer = selectOfferForHold(search);
    const smokePricingPort = 29658; const smokeReservationPort = 29659;
    const smokeInventory = new PricingInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService')(smokeOwner, 'system') as never);
    const smokePricingApp = await createPricingServer({ url: `127.0.0.1:${smokePricingPort}`, internalApiKey: key, runtime: { prisma: pricing, inventory: smokeInventory } }); await smokePricingApp.listen();
    let client: ReservationClient | undefined; let smokeReservationApp: INestMicroservice | undefined;
    try {
      const smokePricing = factory(`127.0.0.1:${smokePricingPort}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService')(smokeOwner, 'customer') as PricingClient;
      const held = await firstValueFrom(smokePricing.holdOffer({ ownerId: smokeOwner, offerId: offer.offerId, itinerarySelections: offer.itinerarySelections, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() }));
      const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
      const inventoryPort = new GrpcInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService'));
      const reservationPricing = new GrpcPricingGateway(factory(`127.0.0.1:${smokePricingPort}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
      const ticketingPort = new GrpcTicketingGateway(factory(`127.0.0.1:${ports.ticketing}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'));
      const events = new GrpcEventPublisher(factory(`127.0.0.1:${ports.webhooks}`, 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService'));
      const payment = new FakePaymentVerifier(); const create = new CreateReservation(store, reservationPricing, payment, ancillary, inventoryPort, ticketingPort, events); const queries = new ReservationQueries(store, ancillary, ticketingPort); const resume = new ResumePending(store, payment, events, ancillary, inventoryPort, ticketingPort);
      smokeReservationApp = await createReservationServer({ url: `127.0.0.1:${smokeReservationPort}`, internalApiKey: key, deps: { createReservation: (input) => create.execute(input as never), getReservation: (input) => queries.get(input as never), listReservations: (input) => queries.list(input as never), getReservationSnapshot: (input) => queries.get(input as never), listReservationsByFlightInstance: (input) => queries.byFlightInstance(input as never), resumePending: (input) => resume.execute(input as never) } }); await smokeReservationApp.listen();
      const definition = loadSync(`${findProtoRoot()}/flightplatform/reservation/v1/reservation.proto`, { includeDirs: [findProtoRoot()], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true }); const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => ReservationClient } } } }; client = new pkg.flightplatform.reservation.v1.ReservationService(`127.0.0.1:${smokeReservationPort}`, credentials.createInsecure());
      const request = { holdId: held.holdId, passengers: [{ ...passenger('', ''), assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() };
      const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', smokeOwner); metadata.set('x-role', 'system');
      await expect(new Promise<unknown>((resolve, reject) => client!.createReservation(request, metadata, (error, response) => error ? reject(error) : resolve(response)))).resolves.toBeDefined();
      const created = await reservation.reservation.findFirstOrThrow({ where: { ownerId: smokeOwner, idempotencyKey: request.idempotencyKey } }); reservations.push(created.id);
    } finally { client?.close(); await smokeReservationApp?.close(); await smokePricingApp.close(); }
  });
});
