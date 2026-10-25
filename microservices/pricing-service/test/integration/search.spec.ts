import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { INestMicroservice } from '@nestjs/common';
import { toHoldResponse, toHoldStatusResponse, toSearchResponse } from '../../src/application/openapi-mappers';
import { AvailableFlight } from '../../src/application/ports';
import { FakeInventoryGateway } from '../../src/infrastructure/inventory/fake-inventory.gateway';
import { createPricingServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const key = 'p'.repeat(40);
const owner = `pricing-search-${randomUUID()}`;
const flightId = randomUUID();
const segmentId = randomUUID();
const departureDate = '2026-12-01';
const flight: AvailableFlight = {
  cabinClass: 'ECONOMY', availableSeats: 9,
  segment: { segmentId, flightInstanceId: flightId, flightNumber: 'FP100', departure: { iataCode: 'UIO', at: `${departureDate}T13:00:00.000Z` }, arrival: { iataCode: 'GYE', at: `${departureDate}T14:00:00.000Z` }, marketingCarrier: 'FP', operatingCarrier: 'FP', aircraft: 'E190', durationMinutes: 60 }
};
const openapi = parse(readFileSync(join(process.cwd(), 'contracts/openapi/vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> } };
const validateOpenApi = (name: 'SearchResponse' | 'HoldResponse' | 'HoldStatusResponse', value: unknown) => {
  const ajv = new Ajv({ strict: false, formats: { 'date-time': true, uuid: true } });
  const schema = { ...openapi.components.schemas[name], components: openapi.components };
  expect(ajv.compile(schema)(value)).toBe(true);
};
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void>;

describe('PRC-06/07: búsqueda y resolución de oferta', () => {
  let prisma: PrismaClient;
  let app: INestMicroservice;
  let client: Client;
  const offerIds: string[] = [];
  const holdIds: string[] = [];
  const call = <T>(method: string, request: unknown, role = 'customer') => new Promise<T>((resolve, reject) => {
    const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', owner); metadata.set('x-role', role);
    client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T));
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.fare.create({ data: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 10_000, taxesMinor: 2_000, rules: { changeable: false, refundable: false }, baggage: { checkedBags: 0 }, extraBagMinor: 5_000 } });
    const port = 28000 + Math.floor(Math.random() * 1000);
    app = await createPricingServer({ url: `127.0.0.1:${port}`, internalApiKey: key, runtime: { prisma, clock: { now: () => new Date('2026-11-01T00:00:00.000Z') }, inventory: new FakeInventoryGateway([flight]), config: { airlineName: 'Flight Platform' } } });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(join(root, 'flightplatform/pricing/v1/pricing.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { pricing: { v1: { PricingService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.pricing.v1.PricingService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => {
    try { await prisma.priceLock.deleteMany({ where: { holdId: { in: holdIds } } }); await prisma.offer.deleteMany({ where: { id: { in: offerIds } } }); await prisma.fare.deleteMany({ where: { flightInstanceId: flightId } }); }
    finally { await app?.close(); await prisma?.$disconnect(); }
  });

  it('PRC-06 / K: persiste una oferta completa mapeable 1:1 a SearchResponse', async () => {
    const response = await call<{ totalOffers: number; offers: Array<Record<string, unknown>> }>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    offerIds.push(String(response.offers[0].offerId));
    expect(response.totalOffers).toBe(1);
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: String(response.offers[0].offerId) } });
    const mapped = toSearchResponse({ totalOffers: response.totalOffers, offers: [offer.snapshot as never] });
    expect(mapped).toMatchObject({ totalOffers: 1, offers: [{ offerId: response.offers[0].offerId, itineraries: [{ pricingOptions: [{ fareBrand: 'BASIC', availableSeats: 9 }] }] }] });
    validateOpenApi('SearchResponse', mapped);
  });

  it('PRC-ADM-02 / I: crea, actualiza e idempotentemente conserva una tarifa usada en búsqueda real', async () => {
    const fare = { flightInstanceId: flightId, cabinClass: 'ECONOMY', fareBrand: 'FLEX', price: { currency: 'USD', baseFare: '130.00', taxes: '20.00', total: '150.00' }, fareRules: { isRefundable: true, isChangeable: true }, baggageAllowance: { checkedBaggageIncluded: 1 }, extraCheckedBaggagePrice: { currency: 'USD', total: '50.00' } };
    await call('upsertFare', fare, 'admin');
    await call('upsertFare', { ...fare, price: { currency: 'USD', baseFare: '140.00', taxes: '20.00', total: '160.00' } }, 'admin');
    expect(await prisma.fare.count({ where: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'FLEX' } })).toBe(1);
    await expect(prisma.fare.findUnique({ where: { flightInstanceId_cabinClass_brand: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'FLEX' } }, select: { baseFareMinor: true, taxesMinor: true } })).resolves.toEqual({ baseFareMinor: 14_000, taxesMinor: 2_000 });
    const searched = await call<{ offers: Array<{ offerId: string; itineraries: Array<{ pricingOptions: Array<{ fareBrand: string; pricePerPassengerType: Array<{ passengerType: string; price: { total: string } }> }> }> }> }>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    offerIds.push(searched.offers[0].offerId);
    const option = searched.offers[0].itineraries[0].pricingOptions.find((item) => item.fareBrand === 'FLEX');
    expect(option?.pricePerPassengerType.find((item) => item.passengerType === 'TOTAL')?.price.total).toBe('160.00');
  });

  it('PRC-08 / PRC-09 / K: crea, consulta y libera el hold con precio bloqueado', async () => {
    const searched = await call<{ offers: Array<{ offerId: string; itineraries: Array<{ itineraryId: string }> }> }>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    offerIds.push(searched.offers[0].offerId);
    const held = await call<{ holdId: string; status: string; expiresAt: string; ttlMinutes: number; lockedPrice: { currency: string; total: string } }>('holdOffer', { ownerId: owner, offerId: searched.offers[0].offerId, itinerarySelections: [{ itineraryId: searched.offers[0].itineraries[0].itineraryId, cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() });
    holdIds.push(held.holdId);
    expect(toHoldResponse(held)).toMatchObject({ holdId: held.holdId, status: 'HELD', lockedPrice: { total: '120.00' } });
    validateOpenApi('HoldResponse', toHoldResponse(held));
    const status = await call<{ status: string; expiresAt: string; remainingSeconds: number; lockedPrice: { currency: string; total: string } }>('getOfferHold', { holdId: held.holdId, ownerId: owner });
    expect(toHoldStatusResponse(status)).toMatchObject({ status: 'HELD', remainingSeconds: expect.any(Number) });
    validateOpenApi('HoldStatusResponse', toHoldStatusResponse(status));
    expect(status.remainingSeconds).toBe(1200);
    await call('releaseOfferHold', { holdId: held.holdId, ownerId: owner });
    await expect(call<{ status: string }>('getOfferHold', { holdId: held.holdId, ownerId: owner })).resolves.toMatchObject({ status: 'RELEASED' });
  });

  it('PRC-08: oferta expirada devuelve OFFER_NO_LONGER_AVAILABLE', async () => {
    const searched = await call<{ offers: Array<{ offerId: string; itineraries: Array<{ itineraryId: string }> }> }>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    offerIds.push(searched.offers[0].offerId);
    await prisma.offer.update({ where: { id: searched.offers[0].offerId }, data: { expiresAt: new Date(0) } });
    await expect(call('holdOffer', { ownerId: owner, offerId: searched.offers[0].offerId, itinerarySelections: [{ itineraryId: searched.offers[0].itineraries[0].itineraryId, cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() })).rejects.toMatchObject({ details: 'OFFER_NO_LONGER_AVAILABLE' });
  });

  it('PRC-SEC-02: GetOfferHold, ReleaseOfferHold y GetPriceLock de otro owner devuelven NOT_FOUND', async () => {
    const searched = await call<{ offers: Array<{ offerId: string; itineraries: Array<{ itineraryId: string }> }> }>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    offerIds.push(searched.offers[0].offerId);
    const held = await call<{ holdId: string }>('holdOffer', { ownerId: owner, offerId: searched.offers[0].offerId, itinerarySelections: [{ itineraryId: searched.offers[0].itineraries[0].itineraryId, cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() });
    holdIds.push(held.holdId);
    const otherOwner = 'another-pricing-owner';
    await expect(call('getOfferHold', { holdId: held.holdId, ownerId: otherOwner })).rejects.toMatchObject({ code: 5 });
    await expect(call('releaseOfferHold', { holdId: held.holdId, ownerId: otherOwner })).rejects.toMatchObject({ code: 5 });
    await expect(call('getPriceLock', { holdId: held.holdId, ownerId: otherOwner })).rejects.toMatchObject({ code: 5 });
  });

  it('PRC-07: ResolveSegment devuelve flightInstanceId y una oferta vencida responde NOT_FOUND', async () => {
    const searched = await call<{ offers: Array<{ offerId: string }> }>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    offerIds.push(searched.offers[0].offerId);
    await expect(call<{ segment: { flightInstanceId: string } }>('resolveSegment', { segmentId })).resolves.toMatchObject({ segment: { flightInstanceId: flightId } });
    await prisma.offer.updateMany({ where: { id: { in: offerIds } }, data: { expiresAt: new Date(0) } });
    await expect(call('resolveSegment', { segmentId })).rejects.toMatchObject({ code: 5 });
  });
});
