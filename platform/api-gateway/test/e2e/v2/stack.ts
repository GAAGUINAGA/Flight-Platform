/* global fetch */
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { setTimeout } from 'node:timers';
import { randomInt, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { jest } from '@jest/globals';
import type { INestApplication, INestMicroservice } from '@nestjs/common';
import { createGrpcClient, SystemClock, withGrpcCallContext } from '@flight-platform/shared';
import { PrismaClient as InventoryPrisma } from '@prisma/client';
import { PrismaClient as PricingPrisma } from '../../../../../microservices/pricing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as AncillariesPrisma } from '../../../../../microservices/ancillaries-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as TicketingPrisma } from '../../../../../microservices/ticketing-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as WebhooksPrisma } from '../../../../../microservices/webhooks-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as ReservationPrisma } from '../../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as OperationsPrisma } from '../../../../../microservices/operations-service/src/infrastructure/persistence/prisma-client/client';
import { createOperationsRuntime } from '../../../../../microservices/operations-service/src/main';
import { createOperationsServer } from '../../../../../microservices/operations-service/src/infrastructure/grpc/server';
import { createInventoryServer } from '../../../../../microservices/inventory-service/src/infrastructure/grpc/server';
import { GrpcEventPublisher as InventoryEventPublisher } from '../../../../../microservices/inventory-service/src/infrastructure/events/grpc-event-publisher';
import { createPricingServer, findProtoRoot } from '../../../../../microservices/pricing-service/src/infrastructure/grpc/server';
import { createAncillariesServer } from '../../../../../microservices/ancillaries-service/src/infrastructure/grpc/server';
import { createTicketingServer } from '../../../../../microservices/ticketing-service/src/infrastructure/grpc/server';
import { AesGcmCipher } from '../../../../../microservices/webhooks-service/src/infrastructure/security/webhook-security';
import { createWebhooksServer } from '../../../../../microservices/webhooks-service/src/infrastructure/grpc/server';
import { createReservationServer } from '../../../../../microservices/reservation-service/src/infrastructure/grpc/server';
import { GrpcInventoryGateway as PricingInventory } from '../../../../../microservices/pricing-service/src/infrastructure/inventory/grpc-inventory.gateway';
import { GrpcPricingGateway as AncillariesPricing } from '../../../../../microservices/ancillaries-service/src/infrastructure/clients/grpc-gateways';
import { GrpcAncillariesGateway, GrpcEventPublisher, GrpcInventoryGateway, GrpcPricingGateway, GrpcServiceForOwner, GrpcTicketingGateway } from '../../../../../microservices/reservation-service/src/infrastructure/clients/grpc-gateways';
import { FakePaymentVerifier } from '../../../../../microservices/reservation-service/src/infrastructure/clients/fakes';
import { BookingPaymentVerifier } from '../../../../../microservices/reservation-service/src/infrastructure/clients/booking-payments';
import { DEFAULT_FIELDS, DEFAULT_STATUS_MAP } from '../../../../../microservices/reservation-service/src/infrastructure/clients/payment-status-map';
import { RoutingPaymentVerifier } from '../../../../../microservices/reservation-service/src/infrastructure/clients/routing-payment-verifier';
import { PrismaReservationStore } from '../../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-reservation-store';
import { PrismaBaggageOperations } from '../../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-baggage-operations';
import { PrismaCancellationQuotes } from '../../../../../microservices/reservation-service/src/infrastructure/persistence/prisma-cancellation-quotes';
import { composeReservation } from '../../../../../microservices/reservation-service/src/infrastructure/grpc/reservation-composition';
import { createResponseValidator } from '../../../../../microservices/reservation-service/src/infrastructure/grpc/openapi-response-validator';
import { loadConfig } from '../../../src/config';
import { createGatewayApp, DEV_AUTH_STORE } from '../../../src/app';
import { GatewayScheduler } from '../../../src/scheduler';
import { PrismaSchedulerStore } from '../../../src/scheduler-store';
import { DevAuthService, type DevAuthClientStore } from '../../../src/v2/dev-auth';
import { registerClient, type TestClient } from './support';

const INTERNAL = 'gateway-real-internal-key-for-local-testing';
const WEBHOOK_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
type Name = 'inventory' | 'pricing' | 'ancillaries' | 'reservation' | 'ticketing' | 'webhooks' | 'operations';
const NAMES: Name[] = ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'webhooks', 'operations'];

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createNetServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') { server.close(); reject(new Error('No local port')); return; } server.close((error) => error ? reject(error) : resolve(address.port)); });
});

export interface PaymentReply { estado?: string; monto?: number | string; moneda?: string; httpStatus?: number; delayMs?: number; raw?: unknown }
/** Simulador de `GET /pagos/{paymentReference}` de Booking: cada prueba registra la respuesta que quiere. */
export class PaymentSimulator {
  readonly replies = new Map<string, PaymentReply>(); readonly requests: string[] = []; authSeen: Array<string | undefined> = []; private server?: HttpServer; port = 0; down = false;
  async start(): Promise<void> {
    this.server = createHttpServer((request, response) => {
      const reference = decodeURIComponent((request.url ?? '').replace(/^\/pagos\//, '')); this.requests.push(reference); this.authSeen.push(request.headers.authorization);
      const reply = this.replies.get(reference);
      const finish = () => {
        if (this.down) { response.writeHead(503); response.end(); return; }
        if (!reply) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return; }
        response.writeHead(reply.httpStatus ?? 200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(reply.raw ?? { estado: reply.estado, monto: reply.monto, moneda: reply.moneda }));
      };
      if (reply?.delayMs) setTimeout(finish, reply.delayMs); else finish();
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve)); this.port = (this.server.address() as { port: number }).port;
  }
  set(reference: string, reply: PaymentReply): void { this.replies.set(reference, reply); }
  confirmed(reference: string, total: string, currency = 'USD'): void { this.set(reference, { estado: 'CONFIRMADO', monto: total, moneda: currency }); }
  async stop(): Promise<void> { await new Promise<void>((resolve) => this.server ? this.server.close(() => resolve()) : resolve()); }
}

export interface Scenario {
  clientId: string; client: TestClient; extraClient(): Promise<TestClient>; origin: string; destination: string; flightNumber: string; flightId: string; aircraft: string; departure: Date; date: string; seats: string[];
  /** Busca la oferta del vuelo del escenario y devuelve lo necesario para bloquear. */
  search(passengers?: Record<string, number>): Promise<{ offerId: string; itineraryId: string; segmentId: string; cabinClass: string; fareBrand: string; grandTotal: { currency: string; total: string } }>;
  cleanup(): Promise<void>;
}

export interface Stack {
  gateway: INestApplication; server: ReturnType<INestApplication['getHttpServer']>; payments: PaymentSimulator; devAuth: DevAuthService; clients: DevAuthClientStore;
  db: { inventory: InventoryPrisma; pricing: PricingPrisma; ancillaries: AncillariesPrisma; reservation: ReservationPrisma; ticketing: TicketingPrisma; webhooks: WebhooksPrisma; operations: OperationsPrisma };
  scheduler: GatewayScheduler; newClient(scopes?: string[]): Promise<TestClient>; scenario(options?: { sellable?: number; domestic?: boolean; hoursAhead?: number; origin?: string; destination?: string; changeable?: boolean }): Promise<Scenario>; dispatchWebhooks(): Promise<number>; subscribe(ownerId: string, events: string[], secret?: string, apiVersion?: '1' | '2'): Promise<{ id: string; secret: string }>; close(): Promise<void>;
}

export async function startStack(env: Record<string, string | undefined> = {}): Promise<Stack> {
  const apps: INestMicroservice[] = []; const channels: Array<{ close(): void }> = []; const databases: Array<{ $disconnect(): Promise<void> }> = []; const ports = {} as Record<Name, number>; const prior = new Map<string, string | undefined>();
  const database = (name: Name) => { const values: Record<string, string> = {}; dotenv.config({ path: join(process.cwd(), 'microservices', `${name}-service`, '.env'), processEnv: values, quiet: true }); if (!values.DATABASE_URL) throw new Error(`DATABASE_URL is required for ${name}`); return values.DATABASE_URL; };
  const service = (name: Name, owner?: string, role = 'customer') => { const options = { url: `127.0.0.1:${ports[name]}`, grpcTls: false, internalApiKey: INTERNAL, correlationId: 'gateway-v2-real', ownerId: owner, role, packageName: `flightplatform.${name}.v1`, protoPath: join(findProtoRoot(), 'flightplatform', name, 'v1', `${name}.proto`), serviceName: `${name[0].toUpperCase()}${name.slice(1)}Service` }; const client = createGrpcClient(options); channels.push(client as unknown as { close(): void }); return withGrpcCallContext(client.getService(options.serviceName), options); };
  const factory = (name: Name): GrpcServiceForOwner => (owner, role) => service(name, owner, role) as ReturnType<GrpcServiceForOwner>;
  const start = async (app: INestMicroservice) => { apps.push(app); await app.listen(); };
  const set = (name: string, value: string) => { if (!prior.has(name)) prior.set(name, process.env[name]); process.env[name] = value; };

  const allocated = new Set<number>();
  for (const name of NAMES) { let port: number; do { port = await freePort(); } while (allocated.has(port)); allocated.add(port); ports[name] = port; set(`${name.toUpperCase()}_GRPC_URL`, `127.0.0.1:${port}`); }
  set('GRPC_TLS', 'false');
  const payments = new PaymentSimulator(); await payments.start();
  const inventory = new InventoryPrisma({ datasources: { db: { url: database('inventory') } } }); const pricing = new PricingPrisma({ datasources: { db: { url: database('pricing') } } }); const ancillaries = new AncillariesPrisma({ datasources: { db: { url: database('ancillaries') } } });
  const ticketing = new TicketingPrisma({ datasources: { db: { url: database('ticketing') } } }); const webhooks = new WebhooksPrisma({ datasources: { db: { url: database('webhooks') } } }); const reservation = new ReservationPrisma({ datasources: { db: { url: database('reservation') } } }); const operations = new OperationsPrisma({ datasources: { db: { url: database('operations') } } });
  databases.push(inventory, pricing, ancillaries, ticketing, webhooks, reservation, operations);
  await start(await createWebhooksServer({ url: `127.0.0.1:${ports.webhooks}`, internalApiKey: INTERNAL, encryptionKey: WEBHOOK_KEY, prisma: webhooks }));
  await start(await createInventoryServer({ url: `127.0.0.1:${ports.inventory}`, internalApiKey: INTERNAL, runtime: { prisma: inventory, events: new InventoryEventPublisher(service('webhooks') as never) } }));
  await start(await createPricingServer({ url: `127.0.0.1:${ports.pricing}`, internalApiKey: INTERNAL, runtime: { prisma: pricing, inventory: new PricingInventory(service('inventory') as never) } }));
  await start(await createAncillariesServer({ url: `127.0.0.1:${ports.ancillaries}`, internalApiKey: INTERNAL, runtime: { prisma: ancillaries, pricing: new AncillariesPricing(service('pricing') as never) } }));
  await start(await createTicketingServer({ url: `127.0.0.1:${ports.ticketing}`, internalApiKey: INTERNAL, prisma: ticketing }));
  const bookingVerifier = new BookingPaymentVerifier({ baseUrl: `http://127.0.0.1:${payments.port}`, pathTemplate: '/pagos/{paymentReference}', authHeader: 'Authorization', authValue: 'Bearer simulator-credential', timeoutMs: 1500, statusMap: DEFAULT_STATUS_MAP, fields: DEFAULT_FIELDS, verify: 'on' });
  const deps = composeReservation({ store: new PrismaReservationStore(reservation), pricing: new GrpcPricingGateway(factory('pricing')), payment: new RoutingPaymentVerifier(new FakePaymentVerifier(), { BOOKING: bookingVerifier }), ancillaries: new GrpcAncillariesGateway(factory('ancillaries')), inventory: new GrpcInventoryGateway(factory('inventory')), ticketing: new GrpcTicketingGateway(factory('ticketing')), events: new GrpcEventPublisher(factory('webhooks')), operations: new PrismaBaggageOperations(reservation), quotes: new PrismaCancellationQuotes(reservation), clock: new SystemClock(), cutoffHours: 4, holdTtlMinutes: 20, validateResponse: createResponseValidator() });
  await start(await createReservationServer({ url: `127.0.0.1:${ports.reservation}`, internalApiKey: INTERNAL, deps }));
  const operationsRuntime = createOperationsRuntime(INTERNAL, operations);
  await start(await createOperationsServer({ url: `127.0.0.1:${ports.operations}`, internalApiKey: INTERNAL, runtime: operationsRuntime.runtime }));
  // El lease durable del scheduler se verifica en scheduler.spec.ts; aquí se sustituye solo para invocar la tarea real.
  const acquire = jest.spyOn(PrismaSchedulerStore.prototype, 'acquire').mockResolvedValue(true); const release = jest.spyOn(PrismaSchedulerStore.prototype, 'release').mockResolvedValue(undefined);
  const gateway = await createGatewayApp(loadConfig({ NODE_ENV: 'test', INTERNAL_API_KEY: INTERNAL, VALIDATE_RESPONSES: 'true', SCHEDULER_ENABLED: 'false', PUBLIC_BASE_URL: 'http://gateway.test', JWT_ISSUERS: JSON.stringify([{ iss: 'unused', aud: 'authenticated', jwksUri: 'http://127.0.0.1:9/jwks.json' }]), RATE_LIMIT_PUBLIC_PER_MIN: '1000', RATE_LIMIT_AUTH_PER_MIN: '1000', ...env }));
  await gateway.listen(0, '127.0.0.1');
  const clients = gateway.get(DEV_AUTH_STORE) as DevAuthClientStore; const scheduler = gateway.get(GatewayScheduler);
  const ALL = ['flights:read', 'flights:hold', 'flights:book', 'flights:cancel', 'flights:webhooks', 'flights:ops', 'flights:admin'];
  const dispatchWebhooks = async () => { const client = service('webhooks', undefined, 'system') as unknown as { dispatchPending(input: object): import('rxjs').Observable<{ dispatchedCount: number }> }; const { firstValueFrom } = await import('rxjs'); return (await firstValueFrom(client.dispatchPending({}))).dispatchedCount; };

  const scenario: Stack['scenario'] = async (options = {}) => {
    const client = await registerClient(clients, ALL); const flightId = randomUUID(); const code = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(0, 26))).join('');
    const origin = options.origin ?? (options.domestic ? 'UIO' : code()); let destination = options.destination ?? (options.domestic ? 'GYE' : code()); if (destination === origin) destination = 'QQQ';
    // El número es FP + 4 dígitos (patrón del contrato); se descartan los que otro escenario o una corrida anterior dejó en Inventory u Operations.
    let flightNumber = ''; for (let attempt = 0; attempt < 50; attempt += 1) { flightNumber = `FP${randomInt(1000, 10000)}`; if (await inventory.flightInstance.count({ where: { flightNumber } }) === 0 && await operations.operationalFlight.count({ where: { flightNumber } }) === 0) break; }
    const aircraft = `T${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const departure = new Date(Date.now() + (options.hoursAhead ?? 5 * 24) * 3_600_000); const date = departure.toISOString().slice(0, 10); const seats = ['1A', '1B', '1C'];
    const offerIds: string[] = []; const clientIds = [client.clientId];
    await inventory.flightInstance.create({ data: { id: flightId, flightNumber, departureIata: origin, arrivalIata: destination, departureAt: departure, arrivalAt: new Date(departure.getTime() + 3_600_000), aircraft, cabins: { create: { cabinClass: 'ECONOMY', sellable: options.sellable ?? 5 } } } });
    await operations.operationalFlight.create({ data: { flightInstanceId: flightId, flightNumber, date, marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: origin, arrivalIata: destination, scheduledDepartureAt: departure, scheduledArrivalAt: new Date(departure.getTime() + 3_600_000), aircraft, status: 'SCHEDULED' } });
    await pricing.fare.create({ data: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'CLASSIC', baseFareMinor: 10000, taxesMinor: 2000, rules: { changeable: options.changeable ?? true, refundable: true }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 } });
    for (const [index, seatNumber] of seats.entries()) await ancillaries.seatLayout.create({ data: { aircraft, cabinClass: 'ECONOMY', seatNumber, rowNumber: index + 1, characteristics: ['WINDOW'] } });
    return {
      clientId: client.clientId, client, async extraClient() { const extra = await registerClient(clients, ALL); clientIds.push(extra.clientId); return extra; }, origin, destination, flightNumber, flightId, aircraft, departure, date, seats,
      async search(passengers = { adults: 1 }) {
        const response = await fetch(`http://127.0.0.1:${(gateway.getHttpServer().address() as { port: number }).port}/api/v2/vuelos/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-fingerprint': randomUUID() }, body: JSON.stringify({ itineraries: [{ origin, destination, departureDate: date }], passengers }) });
        const body = await response.json() as { offers: Array<{ offerId: string; grandTotal: { currency: string; total: string }; itineraries: Array<{ itineraryId: string; segments: Array<{ segmentId: string; flightNumber: string }>; pricingOptions: Array<{ cabinClass: string; fareBrand: string }> }> }> };
        offerIds.push(...body.offers.map((offer) => offer.offerId));
        const offer = body.offers.find((item) => item.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === flightNumber)));
        if (!offer) throw new Error('offer of the scenario not found'); const itinerary = offer.itineraries[0]; const option = itinerary.pricingOptions[0];
        return { offerId: offer.offerId, itineraryId: itinerary.itineraryId, segmentId: itinerary.segments[0].segmentId, cabinClass: option.cabinClass, fareBrand: option.fareBrand, grandTotal: offer.grandTotal };
      },
      async cleanup() {
        const owned = { OR: clientIds.map((id) => ({ ownerId: { startsWith: id } })) }; const rows = await reservation.reservation.findMany({ where: owned, select: { id: true } }); const ids = rows.map((row) => row.id);
        const holds = await inventory.hold.findMany({ where: owned, select: { id: true } }); const holdIds = holds.map((row) => row.id);
        await operations.checkIn.deleteMany({ where: owned });
        await ancillaries.baggageAllowance.deleteMany({ where: owned }); await ancillaries.baggageItem.deleteMany({ where: owned }); await ancillaries.seatAssignment.deleteMany({ where: owned }); await ancillaries.bookingOwner.deleteMany({ where: owned });
        await ticketing.issuanceRequest.deleteMany({ where: { bookingId: { in: ids } } }); await ticketing.ticket.deleteMany({ where: owned }); await reservation.reservation.deleteMany({ where: owned });
        await pricing.priceLock.deleteMany({ where: owned }); await pricing.offer.deleteMany({ where: { id: { in: offerIds } } }); await inventory.reservedInventory.deleteMany({ where: owned }); await inventory.hold.deleteMany({ where: { id: { in: holdIds } } });
        await webhooks.delivery.deleteMany({ where: { subscription: owned } }); await webhooks.subscription.deleteMany({ where: owned }); await webhooks.event.deleteMany({ where: owned });
        await pricing.fare.deleteMany({ where: { flightInstanceId: flightId } }); await ancillaries.seatLayout.deleteMany({ where: { aircraft } }); await operations.operationalFlight.deleteMany({ where: { flightInstanceId: flightId } }); await inventory.flightInstance.deleteMany({ where: { id: flightId } });
      }
    };
  };

  return {
    gateway, server: gateway.getHttpServer(), payments, devAuth: gateway.get(DevAuthService), clients, db: { inventory, pricing, ancillaries, reservation, ticketing, webhooks, operations }, scheduler,
    newClient: (scopes = ALL) => registerClient(clients, scopes), scenario, dispatchWebhooks,
    // La suscripción se inserta directo: la política de URL de Webhooks (con razón) rechaza cualquier receptor local; las entregas se verifican en sus filas.
    async subscribe(ownerId, events, secret = `secret-${randomUUID()}`, apiVersion = '2') { const id = randomUUID(); await webhooks.subscription.create({ data: { id, ownerId, url: 'https://hooks.example.test/booking', events, encryptedSecret: new AesGcmCipher(WEBHOOK_KEY).encrypt(secret), active: true, apiVersion } }); return { id, secret }; },
    async close() {
      await gateway.close(); operationsRuntime.close(); acquire.mockRestore(); release.mockRestore();
      await Promise.allSettled(apps.reverse().map((app) => app.close())); await Promise.allSettled(channels.map(async (channel) => channel.close())); await Promise.allSettled(databases.map((db) => db.$disconnect()));
      await payments.stop();
      for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  };
}
