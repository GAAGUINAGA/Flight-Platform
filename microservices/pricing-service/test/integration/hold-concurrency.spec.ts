import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { AvailableFlight, InventoryHold } from '../../src/application/ports';
import { FakeInventoryGateway } from '../../src/infrastructure/inventory/fake-inventory.gateway';
import { createPricingServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

type Cabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
type Segment = { flightInstanceId: string; cabinClass: Cabin; seats: number };
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void>;

const key = 'h'.repeat(40);
const runId = randomUUID().slice(0, 8);
const flightId = randomUUID();
const departureDate = '2026-12-01';
const flight: AvailableFlight = {
  cabinClass: 'ECONOMY', availableSeats: 9,
  segment: { segmentId: randomUUID(), flightInstanceId: flightId, flightNumber: 'FP100', departure: { iataCode: 'UIO', at: `${departureDate}T13:00:00.000Z` }, arrival: { iataCode: 'GYE', at: `${departureDate}T14:00:00.000Z` }, marketingCarrier: 'FP', operatingCarrier: 'FP', aircraft: 'E190', durationMinutes: 60 }
};

/**
 * Inventory en memoria que imita lo que importa del real: la reserva de cupo es atómica,
 * el par (dueño, llave de idempotencia) devuelve el MISMO hold, y un cupo agotado llega al
 * cliente como error gRPC de cliente `{ code, details }` (sin `getError()`), igual que por la red.
 */
class ConcurrentInventory extends FakeInventoryGateway {
  private left: number;
  private readonly byKey = new Map<string, InventoryHold>();
  private readonly byId = new Map<string, InventoryHold>();
  constructor(capacity: number) { super([flight]); this.left = capacity; }
  setCapacity(capacity: number): void { this.left = capacity; this.byKey.clear(); this.byId.clear(); }
  async createHold(request: { ownerId: string; segments: Segment[]; expiresAt: string; idempotencyKey: string }): Promise<InventoryHold> {
    await sleep(Math.random() * 5); // fuerza el entrelazado de las llamadas simultáneas
    const existing = this.byKey.get(`${request.ownerId}|${request.idempotencyKey}`);
    if (existing) return existing;
    const seats = request.segments.reduce((total, segment) => total + segment.seats, 0);
    if (this.left < seats) throw Object.assign(new Error('9 FAILED_PRECONDITION: OFFER_NO_LONGER_AVAILABLE'), { code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
    this.left -= seats;
    const hold: InventoryHold = { holdId: randomUUID(), ownerId: request.ownerId, status: 'HELD', expiresAt: request.expiresAt, segments: request.segments };
    this.byKey.set(`${request.ownerId}|${request.idempotencyKey}`, hold); this.byId.set(hold.holdId, hold);
    return hold;
  }
  async getHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold> {
    const hold = this.byId.get(request.holdId);
    if (!hold || hold.ownerId !== request.ownerId) throw new Error('hold not found');
    return hold;
  }
  async releaseHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold> {
    const hold = await this.getHold(request);
    const released = { ...hold, status: 'RELEASED' };
    this.byId.set(hold.holdId, released);
    return released;
  }
}

describe('Holds simultáneos de la misma oferta contra Postgres real', () => {
  let prisma: PrismaClient;
  let app: INestMicroservice;
  let client: Client;
  let inventory: ConcurrentInventory;
  let offerId: string;
  let itineraryId: string;
  const holdIds = new Set<string>();
  const mix = { adults: 1, youths: 0, children: 0, infants: 0 };
  const call = <T>(method: string, request: unknown, owner: string) => new Promise<T>((resolve, reject) => {
    const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', owner); metadata.set('x-role', 'customer');
    client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T));
  });
  const hold = (owner: string, idempotencyKey: string) => call<{ holdId: string; status: string }>('holdOffer', {
    ownerId: owner, offerId, idempotencyKey, passengersBreakdown: mix,
    itinerarySelections: [{ itineraryId, cabinClass: 'ECONOMY', fareBrand: 'BASIC' }]
  }, owner);
  const settle = async (calls: Array<Promise<{ holdId: string; status: string }>>) => {
    const results = await Promise.allSettled(calls);
    for (const result of results) if (result.status === 'fulfilled') holdIds.add(result.value.holdId);
    return results;
  };
  const failures = (results: PromiseSettledResult<unknown>[]) => results.flatMap((result) => result.status === 'rejected' ? [result.reason as { code: number; details: string }] : []);
  const successes = (results: PromiseSettledResult<{ holdId: string }>[]) => results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

  beforeAll(async () => {
    inventory = new ConcurrentInventory(0);
    prisma = new PrismaClient();
    await prisma.fare.create({ data: { flightInstanceId: flightId, cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 10_000, taxesMinor: 2_000, rules: { changeable: false, refundable: false }, baggage: { checkedBags: 0 }, extraBagMinor: 5_000 } });
    const port = 29000 + Math.floor(Math.random() * 500);
    app = await createPricingServer({ url: `127.0.0.1:${port}`, internalApiKey: key, runtime: { prisma, clock: { now: () => new Date('2026-11-01T00:00:00.000Z') }, inventory } });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(join(root, 'flightplatform/pricing/v1/pricing.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { pricing: { v1: { PricingService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.pricing.v1.PricingService(`127.0.0.1:${port}`, credentials.createInsecure());
    const searched = await call<{ offers: Array<{ offerId: string; itineraries: Array<{ itineraryId: string }> }> }>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: mix }, `search-${runId}`);
    offerId = searched.offers[0].offerId; itineraryId = searched.offers[0].itineraries[0].itineraryId;
  });
  afterAll(async () => {
    try { await prisma?.priceLock.deleteMany({ where: { OR: [{ holdId: { in: [...holdIds] } }, { offerId }] } }); await prisma?.offer.deleteMany({ where: { id: offerId } }); await prisma?.fare.deleteMany({ where: { flightInstanceId: flightId } }); }
    finally { (client as Client & { close?: () => void } | undefined)?.close?.(); await app?.close(); await prisma?.$disconnect(); }
  });

  it('dueños distintos con cupo: todos los holds se crean y ninguno es INTERNAL_ERROR', async () => {
    inventory.setCapacity(8);
    const results = await settle(Array.from({ length: 8 }, (_, index) => hold(`owner-a-${runId}-${index}`, randomUUID())));
    expect(failures(results)).toEqual([]);
    expect(new Set(successes(results).map((item) => item.holdId)).size).toBe(8);
    expect(await prisma.priceLock.count({ where: { offerId, ownerId: { startsWith: `owner-a-${runId}` } } })).toBe(8);
  });

  it('dueños distintos sin cupo suficiente: quien no cabe recibe OFFER_NO_LONGER_AVAILABLE, nunca INTERNAL_ERROR', async () => {
    inventory.setCapacity(3);
    const results = await settle(Array.from({ length: 8 }, (_, index) => hold(`owner-b-${runId}-${index}`, randomUUID())));
    expect(successes(results)).toHaveLength(3);
    const failed = failures(results);
    expect(failed).toHaveLength(5);
    for (const error of failed) expect(error).toMatchObject({ code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(await prisma.priceLock.count({ where: { offerId, ownerId: { startsWith: `owner-b-${runId}` } } })).toBe(3);
  });

  it('mismo dueño con llaves distintas: cada hold con cupo se crea, el resto recibe error de negocio', async () => {
    inventory.setCapacity(4);
    const owner = `owner-c-${runId}`;
    const results = await settle(Array.from({ length: 6 }, () => hold(owner, randomUUID())));
    expect(successes(results)).toHaveLength(4);
    for (const error of failures(results)) expect(error).toMatchObject({ code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(await prisma.priceLock.count({ where: { offerId, ownerId: owner } })).toBe(4);
  });

  it('misma Idempotency-Key simultánea: un solo hold, un solo precio bloqueado y el hold sigue HELD', async () => {
    inventory.setCapacity(5);
    const owner = `owner-d-${runId}`; const idempotencyKey = randomUUID();
    const results = await settle(Array.from({ length: 6 }, () => hold(owner, idempotencyKey)));
    expect(failures(results)).toEqual([]);
    expect(new Set(successes(results).map((item) => item.holdId)).size).toBe(1);
    expect(await prisma.priceLock.count({ where: { offerId, ownerId: owner } })).toBe(1);
    const [{ holdId }] = successes(results);
    await expect(call<{ status: string }>('getOfferHold', { holdId, ownerId: owner }, owner)).resolves.toMatchObject({ status: 'HELD' });
  });

  it('misma Idempotency-Key repetida después: devuelve el mismo hold sin liberarlo', async () => {
    inventory.setCapacity(5);
    const owner = `owner-e-${runId}`; const idempotencyKey = randomUUID();
    const first = await hold(owner, idempotencyKey); holdIds.add(first.holdId);
    const second = await hold(owner, idempotencyKey);
    expect(second.holdId).toBe(first.holdId);
    expect(await prisma.priceLock.count({ where: { offerId, ownerId: owner } })).toBe(1);
    await expect(call<{ status: string }>('getOfferHold', { holdId: first.holdId, ownerId: owner }, owner)).resolves.toMatchObject({ status: 'HELD' });
  });
});
