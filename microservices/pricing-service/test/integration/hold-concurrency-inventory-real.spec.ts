import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import process from 'node:process';
import dotenv from 'dotenv';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { PrismaClient as PricingPrisma } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaClient as InventoryPrisma } from '@prisma/client';
import { createGrpcClient, withGrpcCallContext } from '@flight-platform/shared';
import { seed as seedInventory } from '../../../inventory-service/prisma/seed';
import { createInventoryServer } from '../../../inventory-service/src/infrastructure/grpc/server';
import { seed as seedPricing } from '../../prisma/seed';
import { InventoryGrpcService } from '../../src/application/ports';
import { createPricingServer, findProtoRoot } from '../../src/infrastructure/grpc/server';
import { GrpcInventoryGateway } from '../../src/infrastructure/inventory/grpc-inventory.gateway';

// Igual que PRC-12: carga el .env de Inventory (dotenv, sin override ni salida de valores) y lo ejecuta el humano o el auditor.
const key = 'c'.repeat(40);
const runId = randomUUID().slice(0, 8);
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void>;
type Searched = { offers: Array<{ offerId: string; itineraries: Array<{ itineraryId: string; segments: Array<{ flightNumber: string }>; pricingOptions: Array<{ cabinClass: string; fareBrand: string; availableSeats: number }> }> }> };

describe('Holds simultáneos de la misma oferta: Pricing contra Inventory local real', () => {
  let pricing: PricingPrisma; let inventory: InventoryPrisma;
  let inventoryApp: INestMicroservice; let pricingApp: INestMicroservice;
  let client: Client; let inventoryClient: ClientGrpc & { close(): void };
  let offerId = ''; let itineraryId = '';
  const holds: Array<{ holdId: string; ownerId: string }> = []; const offerIds: string[] = [];
  const call = <T>(method: string, request: unknown, owner: string) => new Promise<T>((resolve, reject) => { const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', owner); client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T)); });
  const hold = async (ownerId: string, idempotencyKey: string) => {
    const response = await call<{ holdId: string }>('holdOffer', { ownerId, offerId, idempotencyKey, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itinerarySelections: [{ itineraryId, cabinClass: 'ECONOMY', fareBrand: 'BASIC' }] }, ownerId);
    holds.push({ holdId: response.holdId, ownerId });
    return response;
  };
  const failures = (results: PromiseSettledResult<unknown>[]) => results.flatMap((result) => result.status === 'rejected' ? [result.reason as { code: number; details: string }] : []);

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const inventoryEnv: Record<string, string> = {};
    const inventoryEnvFile = join(process.cwd(), 'microservices', 'inventory-service', '.env');
    if (!process.env.INVENTORY_DATABASE_URL && !existsSync(inventoryEnvFile)) throw new Error('requires INVENTORY_DATABASE_URL or microservices/inventory-service/.env');
    if (!process.env.INVENTORY_DATABASE_URL) dotenv.config({ path: inventoryEnvFile, processEnv: inventoryEnv, override: false, quiet: true });
    const inventoryDatabaseUrl = process.env.INVENTORY_DATABASE_URL ?? inventoryEnv.DATABASE_URL;
    if (!inventoryDatabaseUrl) throw new Error('Inventory .env must define DATABASE_URL');
    pricing = new PricingPrisma();
    inventory = new InventoryPrisma({ datasources: { db: { url: inventoryDatabaseUrl } } });
    await seedInventory(inventory); await seedPricing(pricing);
    inventoryApp = await createInventoryServer({ url: '127.0.0.1:29511', internalApiKey: key, runtime: { prisma: inventory } });
    await inventoryApp.listen();
    const root = findProtoRoot();
    const inventoryOptions = { url: '127.0.0.1:29511', grpcTls: false, internalApiKey: key, correlationId: 'hold-concurrency', packageName: 'flightplatform.inventory.v1', protoPath: join(root, 'flightplatform/inventory/v1/inventory.proto'), serviceName: 'InventoryService' };
    inventoryClient = createGrpcClient(inventoryOptions) as ClientGrpc & { close(): void };
    const inventoryService = withGrpcCallContext(inventoryClient.getService<InventoryGrpcService>('InventoryService'), inventoryOptions);
    pricingApp = await createPricingServer({ url: '127.0.0.1:29512', internalApiKey: key, runtime: { prisma: pricing, inventory: new GrpcInventoryGateway(inventoryService) } });
    await pricingApp.listen();
    const definition = loadSync(join(root, 'flightplatform/pricing/v1/pricing.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { pricing: { v1: { PricingService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.pricing.v1.PricingService('127.0.0.1:29512', credentials.createInsecure());
    const departureDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const searched = await call<Searched>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }, `search-${runId}`);
    offerIds.push(...searched.offers.map((item) => item.offerId));
    const found = searched.offers.find((item) => item.itineraries[0].segments[0].flightNumber === 'FP100');
    if (!found) throw new Error('FP100 not offered');
    offerId = found.offerId; itineraryId = found.itineraries[0].itineraryId;
  });
  afterAll(async () => {
    try {
      for (const item of holds) await call('releaseOfferHold', item, item.ownerId).catch(() => undefined);
      await pricing?.priceLock.deleteMany({ where: { holdId: { in: holds.map((item) => item.holdId) } } }); await pricing?.offer.deleteMany({ where: { id: { in: offerIds } } });
    } finally {
      (client as Client & { close?: () => void } | undefined)?.close?.(); inventoryClient?.close();
      await Promise.allSettled([pricingApp?.close(), inventoryApp?.close(), pricing?.$disconnect(), inventory?.$disconnect()]);
    }
  });

  it('dueños distintos y mismo dueño con llaves distintas: ninguna respuesta es INTERNAL_ERROR (el que no cabe recibe OFFER_NO_LONGER_AVAILABLE)', async () => {
    const results = await Promise.allSettled([
      ...Array.from({ length: 6 }, (_, index) => hold(`conc-a-${runId}-${index}`, randomUUID())),
      ...Array.from({ length: 4 }, () => hold(`conc-same-${runId}`, randomUUID()))
    ]);
    for (const error of failures(results)) expect(error).toMatchObject({ code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
  });

  it('misma Idempotency-Key simultánea: un solo hold y un solo precio bloqueado', async () => {
    const owner = `conc-idem-${runId}`; const idempotencyKey = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => hold(owner, idempotencyKey)));
    expect(failures(results)).toEqual([]);
    const ids = new Set(results.flatMap((result) => result.status === 'fulfilled' ? [result.value.holdId] : []));
    expect(ids.size).toBe(1);
    expect(await pricing.priceLock.count({ where: { holdId: { in: [...ids] } } })).toBe(1);
    await expect(call<{ status: string }>('getOfferHold', { holdId: [...ids][0], ownerId: owner }, owner)).resolves.toMatchObject({ status: 'HELD' });
  });
});
