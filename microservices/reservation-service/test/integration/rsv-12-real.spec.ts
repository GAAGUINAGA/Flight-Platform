import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';
import dotenv from 'dotenv';
import { parse } from 'yaml';
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
import { PrismaBaggageOperations } from '../../src/infrastructure/persistence/prisma-baggage-operations';
import { PrismaCancellationQuotes } from '../../src/infrastructure/persistence/prisma-cancellation-quotes';
import { createResponseValidator } from '../../src/infrastructure/grpc/openapi-response-validator';
import { composeReservation } from '../../src/infrastructure/grpc/reservation-composition';
import { SystemClock } from '@flight-platform/shared';

/**
 * RSV-12 is deliberately opt-in: it writes to all six local service schemas.
 * Run only in the principal checkout (never a clean clone):
 *   $env:RUN_RSV12_REAL='true'; npx jest microservices/reservation-service/test/integration/rsv-12-real.spec.ts --runInBand --verbose
 *
 * dotenv loads each local service .env into an isolated object. Values are never
 * copied to stdout/stderr. The test owns every Nest server and Prisma client and
 * closes them even if setup fails.
 */
const run = process.env.RUN_RSV12_REAL === 'true' || process.env.RUN_PST_REAL === 'true';
const describeReal = run ? describe : describe.skip;
const key = 'rsv-12-internal-key-that-is-at-least-32-bytes';
const ownerId = `rsv12-${randomUUID()}`;
const ports = { inventory: 29651, pricing: 29652, ancillaries: 29653, reservation: 29654, ticketing: 29655, webhooks: 29657 };

type ServiceEnv = Record<string, string>;
type PricingClient = { searchOffers(input: unknown): import('rxjs').Observable<PricingSearchResponse>; holdOffer(input: unknown): import('rxjs').Observable<{ holdId: string; expiresAt: string }>; };
type ReservationClient = { createReservation(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; getReservation(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; listReservations(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; getBaggageOptions(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; addBaggage(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; searchDateChange(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; confirmDateChange(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; getCancellationQuote(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; cancelReservation(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close(): void };

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
  const allowanceReservations: string[] = [];

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

  const cleanupOwnerData = async () => {
    if (!reservation || !ancillaries || !inventory || !ticketing || !factory) return;
    const reservationRows = await reservation.reservation.findMany({ where: { ownerId }, select: { id: true } });
    const ownerRows = await ancillaries.bookingOwner.findMany({ where: { ownerId }, select: { bookingId: true } });
    const bookingIds = [...new Set([...reservationRows.map((row) => row.id), ...ownerRows.map((row) => row.bookingId), ...reservations, ...allowanceReservations])];
    const ancillaryPort = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
    const inventoryPort = new GrpcInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService'));
    await Promise.all(bookingIds.map(async (bookingId) => {
      await Promise.allSettled([ancillaryPort.releaseAll({ bookingId, ownerId }), inventoryPort.releaseReservedInventory({ bookingId, ownerId })]);
    }));
    if (bookingIds.length) {
      await Promise.all([ancillaries.baggageItem.deleteMany({ where: { bookingId: { in: bookingIds } } }), ancillaries.baggageAllowance.deleteMany({ where: { bookingId: { in: bookingIds } } }), ancillaries.seatAssignment.deleteMany({ where: { bookingId: { in: bookingIds } } }), ancillaries.bookingOwner.deleteMany({ where: { bookingId: { in: bookingIds } } }), ticketing.ticket.deleteMany({ where: { bookingId: { in: bookingIds } } }), reservation.reservation.deleteMany({ where: { id: { in: bookingIds } } })]);
    }
    reservations.length = 0; allowanceReservations.length = 0;
  };
  afterEach(async () => { await cleanupOwnerData(); });

  afterAll(async () => {
    try { await cleanupOwnerData(); }
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
  const availableSeat = async (segmentId: string, cabinClass = 'ECONOMY') => {
    const [layout, assignments] = await Promise.all([
      ancillaries.seatLayout.findMany({ where: { cabinClass }, select: { seatNumber: true }, orderBy: { seatNumber: 'asc' } }),
      ancillaries.seatAssignment.findMany({ where: { segmentId, status: { not: 'RELEASED' } }, select: { seatNumber: true } })
    ]);
    const occupied = new Set(assignments.map((assignment) => assignment.seatNumber));
    const seat = layout.find((item) => !occupied.has(item.seatNumber))?.seatNumber;
    if (!seat) throw new Error(`no hay asiento ${cabinClass} libre para el escenario RSV-12`);
    return seat;
  };
  const hold = async (expired = false, brand?: string) => {
    const date = new Date(Date.now() + 172800000).toISOString().slice(0, 10);
    const search = await firstValueFrom(pricingClient.searchOffers({ legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }));
    let offer = selectOfferForHold(search);
    if (brand) {
      const candidate = search.offers?.find((item) => item.itineraries?.every((itinerary) => (itinerary.pricingOptions ?? []).some((option) => option.fareBrand === brand)));
      if (candidate?.offerId && candidate.itineraries?.length) {
        offer = { offerId: candidate.offerId, itinerarySelections: candidate.itineraries.map((itinerary) => { const selected = itinerary.pricingOptions!.find((option) => option.fareBrand === brand)!; return { itineraryId: itinerary.itineraryId!, cabinClass: selected.cabinClass!, fareBrand: brand }; }) };
      } else {
        const namedOffer = await searchOfferForBrand(brand);
        const selections = namedOffer.itineraries?.map((itinerary) => {
          const selected = itinerary.pricingOptions?.find((option) => option.fareBrand === brand);
          return selected && itinerary.itineraryId ? { itineraryId: itinerary.itineraryId, cabinClass: selected.cabinClass!, fareBrand: selected.fareBrand! } : undefined;
        });
        if (!namedOffer.offerId || !selections?.length || selections.some((selection) => !selection)) throw new Error(`no se encontro tarifa ${brand} en la oferta`);
        offer = { offerId: namedOffer.offerId, itinerarySelections: selections as Array<{ itineraryId: string; cabinClass: string; fareBrand: string }> };
      }
    }
    const response = await firstValueFrom(pricingClient.holdOffer({ ownerId, offerId: offer.offerId, itinerarySelections: offer.itinerarySelections, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() }));
    if (!response.holdId) throw new Error(`la respuesta de hold no trae holdId; campos: ${fields(response)}`);
    if (expired) await inventory.hold.update({ where: { id: response.holdId }, data: { expiresAt: new Date(0) } });
    const lock = await pricing.priceLock.findUnique({ where: { holdId: response.holdId } });
    if (!lock) throw new Error('el hold creado no tiene price lock persistido');
    const snapshot = itinerarySnapshot(lock.fareSnapshot);
    const heldItineraries = snapshot.itineraries.map((itinerary) => {
      const selection = offer.itinerarySelections.find((item) => item.itineraryId === itinerary.itineraryId);
      const pricingOptions = itinerary.pricingOptions.filter((option) => option.cabinClass === selection?.cabinClass && option.fareBrand === selection?.fareBrand);
      if (!selection || pricingOptions.length !== 1) throw new Error(`no se encontro la tarifa seleccionada ${selection?.fareBrand ?? brand ?? '(sin marca)'}`);
      return { ...itinerary, pricingOptions };
    });
    const grpcPricing = new GrpcPricingGateway(factory(`127.0.0.1:${ports.pricing}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
    const pricingPort: PricingPort = {
      getHold: async (): Promise<HoldDetails> => {
        const mapped = await grpcPricing.getHold({ holdId: response.holdId, ownerId });
        return { ...mapped, status: expired ? 'EXPIRED' : mapped.status, expiresAt: expired ? new Date(0).toISOString() : response.expiresAt, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: heldItineraries };
      }
    };
    return { holdId: response.holdId, segmentId: snapshot.segmentId, seatNumber: await availableSeat(snapshot.segmentId, offer.itinerarySelections[0].cabinClass), pricingPort };
  };
  const services = (pricingPort: PricingPort, payment: PaymentVerifier = new FakePaymentVerifier(), ticketingPort = new GrpcTicketingGateway(factory(`127.0.0.1:${ports.ticketing}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'))) => { const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService')); const inventoryPort = new GrpcInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService')); const events = new GrpcEventPublisher(factory(`127.0.0.1:${ports.webhooks}`, 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService')); const useCase = new CreateReservation(store, pricingPort, payment, ancillary, inventoryPort, ticketingPort, events); return { useCase, resume: new ResumePending(store, payment, events, ancillary, inventoryPort, ticketingPort) }; };
  const openComposedReservationRpc = async () => {
    const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
    const inventoryPort = new GrpcInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService'));
    const pricingPort = new GrpcPricingGateway(factory(`127.0.0.1:${ports.pricing}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
    const ticketingPort = new GrpcTicketingGateway(factory(`127.0.0.1:${ports.ticketing}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'));
    const events = new GrpcEventPublisher(factory(`127.0.0.1:${ports.webhooks}`, 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService'));
    const payment = new FakePaymentVerifier();
    const deps = composeReservation({ store, pricing: pricingPort, payment, ancillaries: ancillary, inventory: inventoryPort, ticketing: ticketingPort, events, operations: new PrismaBaggageOperations(reservation), quotes: new PrismaCancellationQuotes(reservation), clock: new SystemClock(), cutoffHours: 4, holdTtlMinutes: 20, validateResponse: createResponseValidator() });
    const app = await createReservationServer({ url: '127.0.0.1:29660', internalApiKey: key, deps });
    await app.listen();
    const root = findProtoRoot(); const definition = loadSync(join(root, 'flightplatform/reservation/v1/reservation.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => ReservationClient } } } };
    const client = new pkg.flightplatform.reservation.v1.ReservationService('127.0.0.1:29660', credentials.createInsecure());
    const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', ownerId); metadata.set('x-role', 'customer');
    return { app, client, metadata, call: (method: 'createReservation' | 'getBaggageOptions' | 'addBaggage' | 'searchDateChange' | 'confirmDateChange' | 'getCancellationQuote' | 'cancelReservation', value: unknown, requestOwner = ownerId) => { const requestMetadata = new Metadata(); requestMetadata.set('x-internal-key', key); requestMetadata.set('x-owner-id', requestOwner); requestMetadata.set('x-role', 'customer'); return new Promise<unknown>((resolve, reject) => client[method](value, requestMetadata, (error, response) => error ? reject(error) : resolve(response))); } };
  };
  const searchOfferForBrand = async (brand: string) => {
    for (let offset = 2; offset <= 21; offset += 1) {
      const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const result = await firstValueFrom(pricingClient.searchOffers({ legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }));
      const offer = result.offers?.find((candidate) => candidate.offerId && candidate.itineraries?.length && candidate.itineraries.every((itinerary) => itinerary.pricingOptions?.some((option) => option.fareBrand === brand)));
      if (offer?.offerId) return offer;
    }
    throw new Error(`tarifa ${brand} no disponible en los próximos 21 días`);
  };
  const changeableFare = (itinerary: { pricingOptions: Array<{ cabinClass: string; fareBrand: string; fareRules?: { isChangeable?: boolean } }> }) => {
    const fare = itinerary.pricingOptions.find((option) => ['CLASSIC', 'FLEX'].includes(option.fareBrand) && option.fareRules?.isChangeable === true);
    if (!fare) throw new Error('no hay tarifa cambiable en la oferta');
    return fare;
  };
  const assertRealAllowance = async (brand: string, expected: number, extra = 0) => {
    const offer = await searchOfferForBrand(brand); const itinerary = offer.itineraries?.[0];
    const selections = offer.itineraries?.map((item) => { const selected = item.pricingOptions?.find((option) => option.fareBrand === brand); return selected && item.itineraryId ? { itineraryId: item.itineraryId, cabinClass: selected.cabinClass!, fareBrand: selected.fareBrand! } : undefined; });
    if (!itinerary?.itineraryId || !selections?.length || selections.some((selection) => !selection)) throw new Error(`F9-0: tarifa ${brand} incompleta`);
    const held = await firstValueFrom(pricingClient.holdOffer({ ownerId, offerId: offer.offerId!, itinerarySelections: selections as Array<{ itineraryId: string; cabinClass: string; fareBrand: string }>, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() }));
    const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
    const inventoryPort = new GrpcInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService'));
    const pricingPort = new GrpcPricingGateway(factory(`127.0.0.1:${ports.pricing}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
    const ticketingPort = new GrpcTicketingGateway(factory(`127.0.0.1:${ports.ticketing}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'));
    const events = new GrpcEventPublisher(factory(`127.0.0.1:${ports.webhooks}`, 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService'));
    const create = new CreateReservation(store, pricingPort, new FakePaymentVerifier(), ancillary, inventoryPort, ticketingPort, events);
    const app = await createReservationServer({ url: '127.0.0.1:29660', internalApiKey: key, deps: { createReservation: (input) => create.execute(input as never) } });
    let client: ReservationClient | undefined;
    try {
      await app.listen();
      const root = findProtoRoot(); const definition = loadSync(join(root, 'flightplatform/reservation/v1/reservation.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
      const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => ReservationClient } } } };
      client = new pkg.flightplatform.reservation.v1.ReservationService('127.0.0.1:29660', credentials.createInsecure());
      const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', ownerId); metadata.set('x-role', 'customer');
      const pax = { ...passenger(randomUUID(), '1A'), assignedSeats: [], extraBaggage: extra ? [{ itineraryId: itinerary.itineraryId, quantity: extra }] : [] };
      const created = await new Promise<{ bookingId: string }>((resolve, reject) => client!.createReservation({ holdId: held.holdId, passengers: [pax], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }, metadata, (error, response) => error ? reject(error) : resolve(response as { bookingId: string })));
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const owned = await ancillary.getBaggageOptions({ bookingId: created.bookingId, ownerId });
      expect(owned).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId: pax.passengerId, itineraryId: itinerary.itineraryId, checkedBaggageIncluded: expected, alreadyPurchased: extra, maxAllowed: 3 - expected - extra })]));
      await expect(ancillary.getBaggageOptions({ bookingId: created.bookingId, ownerId: `other-${randomUUID()}` })).rejects.toMatchObject({ code: 5 });
    } finally { client?.close(); await app.close(); }
  };
  it('F9-0 / I: reserva real registra franquicia cero y rechaza otro owner por gRPC', async () => { await assertRealAllowance('BASIC', 0); });
  it('F9-0 / I: reserva real registra N maletas incluidas y rechaza otro owner por gRPC', async () => { await assertRealAllowance('CLASSIC', 1); });
  it('PST-02 / I: conserva equipaje extra de compra separado de la franquicia y lo descuenta del límite', async () => { await assertRealAllowance('CLASSIC', 1, 1); });
  it('PST-02 / I: compra postventa real persiste pago, maleta e historial y publica webhook', async () => {
    const selectedOffer = await searchOfferForBrand('BASIC');
    const offer = selectOfferForHold({ offers: [selectedOffer] });
    const held = await firstValueFrom(pricingClient.holdOffer({ ownerId, offerId: offer.offerId, itinerarySelections: offer.itinerarySelections, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() }));
    const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
    const inventoryPort = new GrpcInventoryGateway(factory(`127.0.0.1:${ports.inventory}`, 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService'));
    const pricingPort = new GrpcPricingGateway(factory(`127.0.0.1:${ports.pricing}`, 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
    const ticketingPort = new GrpcTicketingGateway(factory(`127.0.0.1:${ports.ticketing}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'));
    const events = new GrpcEventPublisher(factory(`127.0.0.1:${ports.webhooks}`, 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService'));
    const deps = composeReservation({ store, pricing: pricingPort, payment: new FakePaymentVerifier(), ancillaries: ancillary, inventory: inventoryPort, ticketing: ticketingPort, events, operations: new PrismaBaggageOperations(reservation), quotes: new PrismaCancellationQuotes(reservation), clock: new SystemClock(), cutoffHours: 4, holdTtlMinutes: 20, validateResponse: createResponseValidator() });
    const app = await createReservationServer({ url: '127.0.0.1:29660', internalApiKey: key, deps });
    let client: ReservationClient | undefined;
    try {
      await webhooks.subscription.create({ data: { id: randomUUID(), ownerId, url: 'https://example.test/baggage', events: ['booking.baggage_added'], encryptedSecret: 'test', active: true } });
      await app.listen(); const root = findProtoRoot();
      const definition = loadSync(join(root, 'flightplatform/reservation/v1/reservation.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
      const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { reservation: { v1: { ReservationService: new (address: string, credentials: unknown) => ReservationClient } } } };
      client = new pkg.flightplatform.reservation.v1.ReservationService('127.0.0.1:29660', credentials.createInsecure());
      const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', ownerId); metadata.set('x-role', 'customer');
      const call = (method: 'createReservation' | 'getBaggageOptions' | 'addBaggage', input: unknown) => new Promise<unknown>((resolve, reject) => client![method](input, metadata, (error, response) => error ? reject(error) : resolve(response)));
      const pax = { ...passenger(randomUUID(), '1A'), assignedSeats: [] };
      const created = await call('createReservation', { holdId: held.holdId, passengers: [pax], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const opts = await call('getBaggageOptions', { bookingId: created.bookingId }) as { options: Array<{ passengerId: string; itineraryId: string; maxAllowed: number; price: { total: string } }> };
      expect(opts.options).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId: pax.passengerId, maxAllowed: 3, price: expect.objectContaining({ total: '60.00' }) })]));
      const request = { bookingId: created.bookingId, passengerId: pax.passengerId, itineraryId: offer.itinerarySelections[0].itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() };
      expect(await call('addBaggage', request)).toMatchObject({ passengerId: pax.passengerId, totalBaggage: 1 });
      expect(await call('addBaggage', request)).toMatchObject({ passengerId: pax.passengerId, totalBaggage: 1 });
      expect(await ancillaries.baggageItem.count({ where: { bookingId: created.bookingId, passengerId: pax.passengerId } })).toBe(1);
      expect(await reservation.paymentUsage.count({ where: { reservationId: created.bookingId } })).toBe(2);
      expect(await reservation.reservationChange.count({ where: { reservationId: created.bookingId, description: 'BAGGAGE_ADDED' } })).toBe(1);
      expect(await webhooks.delivery.count({ where: { payload: { path: ['data', 'bookingId'], equals: created.bookingId }, eventId: { not: created.bookingId } } })).toBeGreaterThan(0);
    } finally { client?.close(); await app.close(); }
  });
  it('PST-03/04 / I: busca y confirma cambio con Pricing, Inventory, Ancillaries y Ticketing reales', async () => {
    const fixture = await hold(false, 'CLASSIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const pax = { ...passenger(fixture.segmentId, fixture.seatNumber), assignedSeats: [] };
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [pax], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const stored = await store.findById(ownerId, created.bookingId); if (!stored) throw new Error('reserva real no quedó persistida');
      const oldFare = changeableFare(stored.itineraries[0] as { pricingOptions: Array<{ cabinClass: string; fareBrand: string; fareRules?: { isChangeable?: boolean } }> });
      expect(oldFare).toMatchObject({ fareBrand: 'CLASSIC', fareRules: { isChangeable: true } });
      const route = stored.itineraries[0] as { itineraryId: string; segments: Array<{ segmentId: string; flightInstanceId: string; departure: { at: string } }> };
      const cabinClass = oldFare.cabinClass;
      const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
      const oldSeat = await availableSeat(route.segments[0].segmentId, cabinClass);
      await ancillary.reserveSeats({ bookingId: created.bookingId, ownerId, assignments: [{ segmentId: route.segments[0].segmentId, seatNumber: oldSeat, passengerId: pax.passengerId, passengerType: 'ADULT', cabinClass }] });
      const date = new Date(route.segments[0].departure.at); date.setUTCDate(date.getUTCDate() + 1);
      const searched = await rpc.call('searchDateChange', { bookingId: created.bookingId, changes: [{ itineraryId: route.itineraryId, newDepartureDate: date.toISOString().slice(0, 10) }] }) as { offers: Array<{ changeOfferId: string; segments: Array<{ segmentId: string; flightInstanceId: string }> }> };
      expect(searched.offers.length).toBeGreaterThan(0);
      const offer = searched.offers[0];
      // Pricing's real segment resolver indexes active search offers; prime the new date so
      // Ancillaries can resolve the segment snapshot returned by the change quote.
      await firstValueFrom(pricingClient.searchOffers({ legs: [{ origin: (route.segments[0] as { departure: { iataCode: string } }).departure.iataCode, destination: (route.segments[0] as { arrival: { iataCode: string } }).arrival.iataCode, departureDate: date.toISOString().slice(0, 10) }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }));
      const newSeat = await availableSeat(offer.segments[0].segmentId, cabinClass);
      const oldCabinBefore = await inventory.cabinInventory.findUniqueOrThrow({ where: { flightInstanceId_cabinClass: { flightInstanceId: route.segments[0].flightInstanceId, cabinClass } } });
      const newCabinBefore = await inventory.cabinInventory.findUniqueOrThrow({ where: { flightInstanceId_cabinClass: { flightInstanceId: offer.segments[0].flightInstanceId, cabinClass } } });
      const changed = await rpc.call('confirmDateChange', { bookingId: created.bookingId, changeOfferId: offer.changeOfferId, payment: { paymentReference: `pay_ok_${randomUUID()}` }, assignedSeats: [{ segmentId: offer.segments[0].segmentId, seatNumber: newSeat }], idempotencyKey: randomUUID() }) as { bookingId: string; status: string };
      const rowAfterChange = await reservation.reservation.findUniqueOrThrow({ where: { id: created.bookingId } });
      if (rowAfterChange.status !== 'CONFIRMED') throw new Error(`PST-04 quedó pendiente en paso ${(rowAfterChange.pendingOperation as { step?: string; lastFailureCode?: string } | null)?.step ?? 'unknown'}: ${(rowAfterChange.pendingOperation as { lastFailureCode?: string } | null)?.lastFailureCode ?? 'no failure code'}`);
      expect(changed).toMatchObject({ bookingId: created.bookingId, status: 'CONFIRMED' });
      await expect(reservation.reservation.findUnique({ where: { id: created.bookingId } })).resolves.toMatchObject({ status: 'CONFIRMED' });
      await expect(reservation.reservationChange.count({ where: { reservationId: created.bookingId, description: 'CHANGE_PENDING' } })).resolves.toBe(1);
      await expect(reservation.reservationChange.count({ where: { reservationId: created.bookingId, description: 'CONFIRMED' } })).resolves.toBeGreaterThan(1);
      const oldFlightId = route.segments[0].flightInstanceId;
      await expect(inventory.reservedInventory.findFirst({ where: { reservationId: created.bookingId, flightInstanceId: oldFlightId, releasedAt: null } })).resolves.toBeNull();
      const consumedHold = await inventory.hold.findUniqueOrThrow({ where: { id: rowAfterChange.holdId }, include: { lines: true } });
      expect(consumedHold).toMatchObject({ status: 'CONSUMED', reservationId: created.bookingId });
      await expect(inventory.cabinInventory.findUnique({ where: { flightInstanceId_cabinClass: { flightInstanceId: oldFlightId, cabinClass } } })).resolves.toMatchObject({ sold: oldCabinBefore.sold - 1 });
      await expect(inventory.cabinInventory.findUnique({ where: { flightInstanceId_cabinClass: { flightInstanceId: consumedHold.lines[0].flightInstanceId, cabinClass } } })).resolves.toMatchObject({ sold: newCabinBefore.sold + 1 });
      await expect(ancillaries.seatAssignment.findFirst({ where: { bookingId: created.bookingId, segmentId: route.segments[0].segmentId, status: { not: 'RELEASED' } } })).resolves.toBeNull();
      await expect(ancillaries.seatAssignment.findFirst({ where: { bookingId: created.bookingId, segmentId: offer.segments[0].segmentId, seatNumber: newSeat, status: { not: 'RELEASED' } } })).resolves.toBeTruthy();
      await expect(ticketing.ticket.findMany({ where: { bookingId: created.bookingId }, orderBy: { createdAt: 'asc' } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'VOIDED' }), expect.objectContaining({ status: 'ISSUED' })]));
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('PST-03/04 / S: reserva BASIC devuelve FARE_NOT_CHANGEABLE en búsqueda y confirmación sin efectos', async () => {
    const fixture = await hold(false, 'BASIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [{ ...passenger(randomUUID(), fixture.seatNumber), assignedSeats: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const stored = await store.findById(ownerId, created.bookingId); if (!stored) throw new Error('reserva BASIC no quedo persistida');
      const route = stored.itineraries[0] as { itineraryId: string; segments: Array<{ departure: { at: string }; flightInstanceId: string }> };
      const selected = (stored.itineraries[0] as { pricingOptions: Array<{ fareBrand: string; fareRules: { isChangeable: boolean } }> }).pricingOptions.find((option) => option.fareBrand === 'BASIC');
      if (!selected) throw new Error('no se encontro tarifa BASIC en la reserva');
      expect(selected.fareRules.isChangeable).toBe(false);
      const date = new Date(route.segments[0].departure.at); date.setUTCDate(date.getUTCDate() + 1);
      const changeDate = date.toISOString().slice(0, 10);
      await expect(rpc.call('searchDateChange', { bookingId: created.bookingId, changes: [{ itineraryId: route.itineraryId, newDepartureDate: changeDate }] })).rejects.toMatchObject({ code: 9, details: 'FARE_NOT_CHANGEABLE' });
      await expect(rpc.call('confirmDateChange', { bookingId: created.bookingId, changeOfferId: `basic-${randomUUID()}`, assignedSeats: [], idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 9, details: 'FARE_NOT_CHANGEABLE' });
      await expect(reservation.reservation.findUnique({ where: { id: created.bookingId } })).resolves.toMatchObject({ status: 'CONFIRMED', holdId: fixture.holdId });
      await expect(inventory.hold.findUnique({ where: { id: fixture.holdId } })).resolves.toMatchObject({ status: 'CONSUMED', reservationId: created.bookingId });
      await expect(inventory.reservedInventory.count({ where: { reservationId: created.bookingId, releasedAt: null } })).resolves.toBeGreaterThan(0);
      await expect(ticketing.ticket.count({ where: { bookingId: created.bookingId } })).resolves.toBe(1);
      await expect(pricing.changeOffer.count({ where: { bookingId: created.bookingId } })).resolves.toBe(0);
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('PST-05/06 / I: cotiza y ejecuta cancelación sobre servicios reales', async () => {
    const fixture = await hold(false, 'CLASSIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const pax = { ...passenger(randomUUID(), '1A'), assignedSeats: [] };
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [pax], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const stored = await store.findById(ownerId, created.bookingId); if (!stored) throw new Error('reserva real no persistida');
      const route = stored.itineraries[0] as { itineraryId: string; segments: Array<{ segmentId: string; flightInstanceId: string }> };
      const cabinClass = changeableFare(stored.itineraries[0] as { pricingOptions: Array<{ cabinClass: string; fareBrand: string; fareRules?: { isChangeable?: boolean } }> }).cabinClass;
      const ancillary = new GrpcAncillariesGateway(factory(`127.0.0.1:${ports.ancillaries}`, 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
      const seatNumber = await availableSeat(route.segments[0].segmentId, cabinClass);
      await ancillary.reserveSeats({ bookingId: created.bookingId, ownerId, assignments: [{ segmentId: route.segments[0].segmentId, seatNumber, passengerId: pax.passengerId, passengerType: 'ADULT', cabinClass }] });
      const baggage = await rpc.call('getBaggageOptions', { bookingId: created.bookingId }) as { options: Array<{ itineraryId: string }> };
      await rpc.call('addBaggage', { bookingId: created.bookingId, passengerId: pax.passengerId, itineraryId: baggage.options[0].itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() });
      const inventoryLine = await inventory.holdLine.findFirstOrThrow({ where: { holdId: fixture.holdId } });
      const capacityBeforeCancel = await inventory.cabinInventory.findUniqueOrThrow({ where: { flightInstanceId_cabinClass: { flightInstanceId: inventoryLine.flightInstanceId, cabinClass: inventoryLine.cabinClass } } });
      await webhooks.subscription.create({ data: { id: randomUUID(), ownerId, url: 'https://example.test/cancel', events: ['booking.cancelled'], encryptedSecret: 'test', active: true } });
      const quote = await rpc.call('getCancellationQuote', { bookingId: created.bookingId }) as { quoteId: string; refundAmount: string; currency: string };
      expect(quote).toMatchObject({ currency: 'USD' });
      const cancelled = await rpc.call('cancelReservation', { bookingId: created.bookingId, quoteId: quote.quoteId, idempotencyKey: randomUUID() }) as { bookingId: string; status: string };
      expect(cancelled).toMatchObject({ bookingId: created.bookingId, status: 'CANCELLED' });
      await expect(reservation.reservation.findUnique({ where: { id: created.bookingId } })).resolves.toMatchObject({ status: 'CANCELLED' });
      await expect(ticketing.ticket.findMany({ where: { bookingId: created.bookingId, status: { in: ['VOIDED', 'REFUNDED'] } } })).resolves.toEqual(expect.arrayContaining([expect.any(Object)]));
      await expect(inventory.reservedInventory.findMany({ where: { reservationId: created.bookingId } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ releasedAt: expect.any(Date) })]));
      await expect(inventory.cabinInventory.findUnique({ where: { flightInstanceId_cabinClass: { flightInstanceId: inventoryLine.flightInstanceId, cabinClass: inventoryLine.cabinClass } } })).resolves.toMatchObject({ sold: capacityBeforeCancel.sold - inventoryLine.seats });
      await expect(ancillaries.seatAssignment.findMany({ where: { bookingId: created.bookingId } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'RELEASED' })]));
      await expect(ancillaries.baggageItem.findMany({ where: { bookingId: created.bookingId } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'RELEASED' })]));
      await expect(webhooks.delivery.findFirst({ where: { payload: { path: ['data', 'bookingId'], equals: created.bookingId } } })).resolves.toBeTruthy();
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('PST-07 / C: el mismo cancellation quote en paralelo solo cancela una vez', async () => {
    const fixture = await hold(false, 'CLASSIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [{ ...passenger(randomUUID(), '1A'), assignedSeats: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const quote = await rpc.call('getCancellationQuote', { bookingId: created.bookingId }) as { quoteId: string };
      const results = await Promise.allSettled([1, 2].map(() => rpc.call('cancelReservation', { bookingId: created.bookingId, quoteId: quote.quoteId, idempotencyKey: randomUUID() })));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const loser = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(loser?.reason).toMatchObject({ code: 9, details: 'QUOTE_EXPIRED' });
      await expect(reservation.reservation.findUnique({ where: { id: created.bookingId } })).resolves.toMatchObject({ status: 'CANCELLED' });
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('PST-07 / C: el mismo changeOfferId en paralelo solo se consume una vez', async () => {
    const fixture = await hold(false, 'CLASSIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [{ ...passenger(randomUUID(), '1A'), assignedSeats: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const stored = await store.findById(ownerId, created.bookingId); if (!stored) throw new Error('reserva de concurrencia no persistida');
      const route = stored.itineraries[0] as { itineraryId: string; segments: Array<{ departure: { at: string } }> };
      const date = new Date(route.segments[0].departure.at); date.setUTCDate(date.getUTCDate() + 1);
      const search = await rpc.call('searchDateChange', { bookingId: created.bookingId, changes: [{ itineraryId: route.itineraryId, newDepartureDate: date.toISOString().slice(0, 10) }] }) as { offers: Array<{ changeOfferId: string }> };
      const offer = search.offers[0]; if (!offer) throw new Error('Pricing no devolvió oferta de cambio');
      const results = await Promise.allSettled([1, 2].map(() => rpc.call('confirmDateChange', { bookingId: created.bookingId, changeOfferId: offer.changeOfferId, payment: { paymentReference: `pay_ok_${randomUUID()}` }, assignedSeats: [], idempotencyKey: randomUUID() })));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const loser = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(loser?.reason).toMatchObject({ code: 9, details: 'CHANGE_OFFER_EXPIRED' });
      await expect(pricing.changeOffer.count({ where: { id: offer.changeOfferId, usedAt: { not: null } } })).resolves.toBe(1);
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('PST-SEC-01 / S: cada RPC postventa responde NOT_FOUND para otro owner', async () => {
    const fixture = await hold(false, 'BASIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [{ ...passenger(randomUUID(), '1A'), assignedSeats: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const stored = await store.findById(ownerId, created.bookingId); if (!stored) throw new Error('reserva de seguridad no persistida');
      const route = stored.itineraries[0] as { itineraryId: string; segments: Array<{ departure: { at: string } }> };
      const passengerId = (stored.passengers[0] as { passengerId: string }).passengerId;
      const date = new Date(route.segments[0].departure.at); date.setUTCDate(date.getUTCDate() + 1);
      const quote = await rpc.call('getCancellationQuote', { bookingId: created.bookingId }) as { quoteId: string };
      const other = `other-${randomUUID()}`;
      const requests = [
        rpc.call('getBaggageOptions', { bookingId: created.bookingId }, other),
        rpc.call('addBaggage', { bookingId: created.bookingId, passengerId, itineraryId: route.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }, other),
        rpc.call('searchDateChange', { bookingId: created.bookingId, changes: [{ itineraryId: route.itineraryId, newDepartureDate: date.toISOString().slice(0, 10) }] }, other),
        rpc.call('confirmDateChange', { bookingId: created.bookingId, changeOfferId: `basic-${randomUUID()}`, assignedSeats: [], idempotencyKey: randomUUID() }, other),
        rpc.call('getCancellationQuote', { bookingId: created.bookingId }, other),
        rpc.call('cancelReservation', { bookingId: created.bookingId, quoteId: quote.quoteId, idempotencyKey: randomUUID() }, other)
      ];
      const results = await Promise.allSettled(requests);
      expect(results).toHaveLength(6);
      for (const result of results) { expect(result.status).toBe('rejected'); if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 5, details: 'NOT_FOUND' }); }
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('PST-SEC-02 / S: una paymentReference inicial no se reutiliza para equipaje', async () => {
    const fixture = await hold(false, 'CLASSIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const reference = `pay_ok_${randomUUID()}`;
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [{ ...passenger(randomUUID(), '1A'), assignedSeats: [] }], payment: { paymentReference: reference }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const stored = await store.findById(ownerId, created.bookingId); if (!stored) throw new Error('reserva de pago no persistida');
      const route = stored.itineraries[0] as { itineraryId: string }; const passengerId = (stored.passengers[0] as { passengerId: string }).passengerId;
      await expect(rpc.call('addBaggage', { bookingId: created.bookingId, passengerId, itineraryId: route.itineraryId, quantity: 1, payment: { paymentReference: reference }, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 9, details: 'PAYMENT_REFERENCE_INVALID' });
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('PST-SEC-01 / S: los RPC rechazan cantidad fuera de 1–3, fecha pasada e ids inválidos', async () => {
    const fixture = await hold(false, 'CLASSIC'); const rpc = await openComposedReservationRpc(); let client: ReservationClient | undefined = rpc.client;
    try {
      const created = await rpc.call('createReservation', { holdId: fixture.holdId, passengers: [{ ...passenger(randomUUID(), '1A'), assignedSeats: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }) as { bookingId: string };
      reservations.push(created.bookingId); allowanceReservations.push(created.bookingId);
      const stored = await store.findById(ownerId, created.bookingId); if (!stored) throw new Error('reserva para validación no persistida');
      const route = stored.itineraries[0] as { itineraryId: string }; const passengerId = (stored.passengers[0] as { passengerId: string }).passengerId;
      const pastDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const results = await Promise.all([
        rpc.call('addBaggage', { bookingId: created.bookingId, passengerId, itineraryId: route.itineraryId, quantity: 0, payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }),
        rpc.call('addBaggage', { bookingId: created.bookingId, passengerId, itineraryId: route.itineraryId, quantity: 4, payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }),
        rpc.call('searchDateChange', { bookingId: created.bookingId, changes: [{ itineraryId: route.itineraryId, newDepartureDate: pastDate }] }),
        rpc.call('getBaggageOptions', { bookingId: 'invalid-id' })
      ].map((request) => request.then(() => ({ status: 'fulfilled' as const }), (reason) => ({ status: 'rejected' as const, reason }))));
      expect(results).toHaveLength(4);
      for (const result of results) { expect(result.status).toBe('rejected'); if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 3, details: 'VALIDATION_FAILED' }); }
    } finally { client?.close(); await rpc.app.close(); }
  });
  it('RSV-12 / I: ruta feliz emite tickets con los cinco servicios reales', async () => { const fixture = await hold(false, 'BASIC'); await webhooks.subscription.create({ data: { id: randomUUID(), ownerId, url: 'https://example.test/hook', events: ['booking.confirmed'], encryptedSecret: 'test', active: true } }); const created = await services(fixture.pricingPort).useCase.execute({ ownerId, holdId: fixture.holdId, passengers: [passenger(fixture.segmentId, fixture.seatNumber)], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }); reservations.push(created.id); await expect(ticketing.ticket.findMany({ where: { bookingId: created.id } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'ISSUED' })])); await expect(ancillaries.seatAssignment.findFirst({ where: { bookingId: created.id } })).resolves.toMatchObject({ status: 'CONFIRMED' }); await expect(inventory.hold.findUnique({ where: { id: fixture.holdId } })).resolves.toMatchObject({ status: 'CONSUMED' }); await expect(inventory.cabinInventory.findFirst({ where: { sold: { gt: 0 } } })).resolves.toBeTruthy(); await expect(webhooks.delivery.findFirst({ where: { payload: { path: ['data', 'bookingId'], equals: created.id } } })).resolves.toBeTruthy(); });
  it('RSV-12 / I: pago pendiente pasa por ResumePending hasta CONFIRMED', async () => { const fixture = await hold(); let authorized = false; const payment: PaymentVerifier = { verify: async (): Promise<PaymentResult> => authorized ? 'AUTHORIZED' : 'PENDING', void: async () => undefined }; const flow = services(fixture.pricingPort, payment); const created = await flow.useCase.execute({ ownerId, holdId: fixture.holdId, passengers: [passenger(fixture.segmentId, fixture.seatNumber)], payment: { paymentReference: `pay_pending_${randomUUID()}` }, idempotencyKey: randomUUID() }); reservations.push(created.id); expect(created.status).toBe('PENDING_PAYMENT'); authorized = true; await flow.resume.execute({ limit: 50 }); await expect(reservation.reservation.findUnique({ where: { id: created.id } })).resolves.toMatchObject({ status: 'CONFIRMED' }); await expect(ticketing.ticket.findFirst({ where: { bookingId: created.id } })).resolves.toMatchObject({ status: 'ISSUED' }); });
  it('RSV-12 / I: TICKETING_FAIL_MODE=always libera recursos', async () => { const fixture = await hold(false, 'BASIC'); const line = await inventory.holdLine.findFirstOrThrow({ where: { holdId: fixture.holdId } }); const before = await inventory.cabinInventory.findUniqueOrThrow({ where: { flightInstanceId_cabinClass: { flightInstanceId: line.flightInstanceId, cabinClass: line.cabinClass } } }); const port = 29656; const failingApp = await createTicketingServer({ url: `127.0.0.1:${port}`, internalApiKey: key, prisma: ticketing, config: { failMode: 'always' } }); await failingApp.listen(); try { const failing = new GrpcTicketingGateway(factory(`127.0.0.1:${port}`, 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService')); const flow = services(fixture.pricingPort, new FakePaymentVerifier(), failing); const input = { ownerId, holdId: fixture.holdId, passengers: [passenger(fixture.segmentId, fixture.seatNumber)], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }; await expect(flow.useCase.execute(input)).rejects.toThrow('TICKET_ISSUANCE_FAILED'); const row = await reservation.reservation.findFirstOrThrow({ where: { ownerId, idempotencyKey: input.idempotencyKey } }); reservations.push(row.id); await flow.resume.execute({}); await flow.resume.execute({}); await flow.resume.execute({}); await expect(reservation.reservation.findUnique({ where: { id: row.id } })).resolves.toMatchObject({ status: 'FAILED' }); await expect(ticketing.ticket.findMany({ where: { bookingId: row.id } })).resolves.toEqual(expect.not.arrayContaining([expect.objectContaining({ status: 'ISSUED' })])); await expect(ancillaries.seatAssignment.findFirst({ where: { bookingId: row.id } })).resolves.toMatchObject({ status: 'RELEASED' }); await expect(inventory.reservedInventory.findFirst({ where: { reservationId: row.id } })).resolves.toMatchObject({ releasedAt: expect.any(Date) }); await expect(inventory.cabinInventory.findUnique({ where: { flightInstanceId_cabinClass: { flightInstanceId: line.flightInstanceId, cabinClass: line.cabinClass } } })).resolves.toMatchObject({ sold: before.sold }); } finally { await failingApp.close(); } });
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
      const request = { holdId: held.holdId, passengers: [{ passengerId: randomUUID(), passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'SMOKE123', nationality: 'EC', documentExpiryDate: '2030-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'smoke@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() };
      const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', smokeOwner); metadata.set('x-role', 'system');
      const call = (method: 'createReservation' | 'getReservation' | 'listReservations', input: unknown) => new Promise<unknown>((resolve, reject) => client![method](input, metadata, (error, response) => error ? reject(error) : resolve(response)));
      const created = await call('createReservation', request) as { bookingId?: string; pnr?: string; tickets?: Array<{ status?: string }> };
      expect(created.bookingId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      reservations.push(created.bookingId!);
      expect(created.pnr).toMatch(/^[A-Z0-9]{6}$/);
      expect(created.tickets).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'ISSUED' })]));
      expect(created.tickets!.every((ticket) => ticket.status === 'ISSUED')).toBe(true);
      const openapi = parse(readFileSync(join(process.cwd(), 'contracts/openapi/vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> } };
      const validate = new Ajv({ strict: false, formats: { 'date-time': /^\d{4}-\d{2}-\d{2}T.+Z$/, uuid: /^[0-9a-f-]{36}$/i } }).compile({ ...openapi.components.schemas.BookingDetail, components: openapi.components });
      if (!validate(created)) throw new Error(JSON.stringify(validate.errors));
      const detail = await call('getReservation', { bookingId: created.bookingId }) as { bookingId?: string; pnr?: string; tickets?: Array<{ status?: string }>; passengers?: Array<{ assignedSeats?: unknown[]; extraBaggage?: unknown[] }> };
      expect(detail).toMatchObject({ bookingId: created.bookingId, pnr: created.pnr });
      expect(detail.tickets).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'ISSUED' })]));
      expect(detail.tickets!.every((ticket) => ticket.status === 'ISSUED')).toBe(true);
      expect(detail.passengers).toHaveLength(1);
      expect(detail.passengers![0]).toMatchObject({ assignedSeats: [], extraBaggage: [] });
      const listed = await call('listReservations', { page: { limit: 10 } }) as { items?: Array<{ bookingId?: string; pnr?: string }> };
      expect(listed.items).toEqual(expect.arrayContaining([expect.objectContaining({ bookingId: created.bookingId, pnr: created.pnr })]));
    } finally { client?.close(); await smokeReservationApp?.close(); await smokePricingApp.close(); }
  });
});
