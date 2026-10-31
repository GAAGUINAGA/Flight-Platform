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

const key = 'r'.repeat(40);
const owner = 'pricing-real-inventory-owner';
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void>;

describe('PRC-12: integración con Inventory local real', () => {
  let pricing: PricingPrisma;
  let inventory: InventoryPrisma;
  let inventoryApp: INestMicroservice;
  let pricingApp: INestMicroservice;
  let client: Client;
  let inventoryClient: ClientGrpc & { close(): void };
  const offerIds: string[] = []; const holdIds: string[] = [];
  const call = <T>(method: string, request: unknown) => new Promise<T>((resolve, reject) => { const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', owner); client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T)); });

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for PRC-12');
    const inventoryEnv: Record<string, string> = {};
    const inventoryEnvFile = join(process.cwd(), 'microservices', 'inventory-service', '.env');
    if (!process.env.INVENTORY_DATABASE_URL && !existsSync(inventoryEnvFile)) {
      throw new Error('PRC-12 requires INVENTORY_DATABASE_URL or microservices/inventory-service/.env');
    }
    if (!process.env.INVENTORY_DATABASE_URL) dotenv.config({ path: inventoryEnvFile, processEnv: inventoryEnv, override: false, quiet: true });
    const inventoryDatabaseUrl = process.env.INVENTORY_DATABASE_URL ?? inventoryEnv.DATABASE_URL;
    if (!inventoryDatabaseUrl) throw new Error('Inventory .env must define DATABASE_URL for PRC-12');
    pricing = new PricingPrisma();
    inventory = new InventoryPrisma({ datasources: { db: { url: inventoryDatabaseUrl } } });
    await seedInventory(inventory); await seedPricing(pricing);
    const inventoryPort = 29501;
    inventoryApp = await createInventoryServer({ url: `127.0.0.1:${inventoryPort}`, internalApiKey: key, runtime: { prisma: inventory } });
    await inventoryApp.listen();
    const root = findProtoRoot();
    const inventoryOptions = { url: `127.0.0.1:${inventoryPort}`, grpcTls: false, internalApiKey: key, correlationId: 'prc-12', packageName: 'flightplatform.inventory.v1', protoPath: join(root, 'flightplatform/inventory/v1/inventory.proto'), serviceName: 'InventoryService' };
    inventoryClient = createGrpcClient(inventoryOptions) as ClientGrpc & { close(): void };
    const inventoryService = withGrpcCallContext(inventoryClient.getService<InventoryGrpcService>('InventoryService'), inventoryOptions);
    const pricingPort = 29502;
    pricingApp = await createPricingServer({ url: `127.0.0.1:${pricingPort}`, internalApiKey: key, runtime: { prisma: pricing, inventory: new GrpcInventoryGateway(inventoryService) } });
    await pricingApp.listen();
    const definition = loadSync(join(root, 'flightplatform/pricing/v1/pricing.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { pricing: { v1: { PricingService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.pricing.v1.PricingService(`127.0.0.1:${pricingPort}`, credentials.createInsecure());
  });
  afterAll(async () => {
    try { await pricing?.priceLock.deleteMany({ where: { holdId: { in: holdIds } } }); await pricing?.offer.deleteMany({ where: { id: { in: offerIds } } }); }
    finally {
      (client as Client & { close?: () => void } | undefined)?.close?.();
      inventoryClient?.close();
      await Promise.allSettled([pricingApp?.close(), inventoryApp?.close(), pricing?.$disconnect(), inventory?.$disconnect()]);
    }
  });

  it('PRC-12: search → hold → get → release restituye capacidad real de Inventory', async () => {
    const departureDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    type Searched = { offers: Array<{ offerId: string; itineraries: Array<{ itineraryId: string; segments: Array<{ flightNumber: string }>; pricingOptions: Array<{ cabinClass: string; fareBrand: string; availableSeats: number }> }> }> };
    const pick = (response: Searched) => {
      offerIds.push(...response.offers.map((item) => item.offerId));
      const found = response.offers.find((item) => item.itineraries[0].segments[0].flightNumber === 'FP100');
      if (!found) throw new Error('FP100 not offered');
      const itin = found.itineraries[0];
      const choice = itin.pricingOptions.find((item) => item.cabinClass === 'ECONOMY' && item.fareBrand === 'BASIC');
      if (!choice) throw new Error('ECONOMY/BASIC not offered');
      return { offer: found, itinerary: itin, option: choice };
    };
    const searched = await call<Searched>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    const { offer, itinerary, option } = pick(searched); const before = option.availableSeats;
    const hold = await call<{ holdId: string }>('holdOffer', { ownerId: owner, offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() });
    holdIds.push(hold.holdId);
    await expect(call<{ status: string }>('getOfferHold', { holdId: hold.holdId, ownerId: owner })).resolves.toMatchObject({ status: 'HELD' });
    await call('releaseOfferHold', { holdId: hold.holdId, ownerId: owner });
    const after = await call<Searched>('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
    expect(pick(after).option.availableSeats).toBe(before);
  });
});
