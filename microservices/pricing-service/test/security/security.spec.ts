import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { createPricingServer, findProtoRoot } from '../../src/infrastructure/grpc/server';
import { InventoryGateway } from '../../src/application/ports';
import pino from 'pino';
import { loggerOptions } from '@flight-platform/shared';

const key = 's'.repeat(40);
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void>;

describe('PRC-SEC-01/03: frontera segura de Pricing', () => {
  let app: INestMicroservice;
  let client: Client;
  let logs = '';
  const call = (method: string, request: unknown, metadata?: Metadata) => new Promise((resolve, reject) => client[method](request, metadata ?? new Metadata(), (error, response) => error ? reject(error) : resolve(response)));
  beforeAll(async () => {
    const port = 29000 + Math.floor(Math.random() * 500);
    const failingInventory: InventoryGateway = {
      queryAvailability: async () => { throw new Error(`forced internal failure owner-sensitive internal-key-${key}`); },
      createHold: async () => { throw new Error('not used'); }, getHold: async () => { throw new Error('not used'); }, releaseHold: async () => { throw new Error('not used'); }
    };
    const destination = new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } });
    app = await createPricingServer({ url: `127.0.0.1:${port}`, internalApiKey: key, logger: pino(loggerOptions, destination), runtime: { prisma: new PrismaClient(), inventory: failingInventory } });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(join(root, 'flightplatform/pricing/v1/pricing.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { pricing: { v1: { PricingService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.pricing.v1.PricingService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => { await app?.close(); });
  const internal = (role = 'customer', internalKey = key, ownerId?: string) => { const metadata = new Metadata(); metadata.set('x-internal-key', internalKey); metadata.set('x-role', role); if (ownerId) metadata.set('x-owner-id', ownerId); return metadata; };

  it('PRC-SEC-03: RPC sin llave interna es UNAUTHENTICATED', async () => {
    await expect(call('searchOffers', { legs: [], passengers: {} })).rejects.toMatchObject({ code: 16 });
  });
  it('PRC-SEC-03: llave interna incorrecta es UNAUTHENTICATED', async () => {
    await expect(call('searchOffers', { legs: [], passengers: {} }, internal('customer', 'incorrect-key'))).rejects.toMatchObject({ code: 16 });
  });
  it('PRC-SEC-01: entrada inválida es INVALID_ARGUMENT', async () => {
    await expect(call('searchOffers', { legs: [{ origin: 'bad', destination: 'GYE', departureDate: 'no' }], passengers: { adults: 0 }, extra: true }, internal())).rejects.toMatchObject({ code: 3 });
  });
  it('PRC-SEC-03: RPC administrativo con customer es PERMISSION_DENIED', async () => {
    await expect(call('listFares', {}, internal())).rejects.toMatchObject({ code: 7 });
  });
  it('PRC-ADM-01: UpsertFare valida el cuerpo antes de persistir', async () => {
    await expect(call('upsertFare', { flightInstanceId: 'not-a-uuid' }, internal('admin'))).rejects.toMatchObject({ code: 3 });
  });
  it('PRC-SEC-03: error interno forzado en RPC responde INTERNAL sin stack ni mensaje interno', async () => {
    await expect(call('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-15' }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }, internal())).rejects.toMatchObject({ code: 13, details: 'INTERNAL_ERROR' });
    await expect(call('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-15' }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }, internal())).rejects.not.toMatchObject({ details: expect.stringContaining('forced internal failure') });
  });
  it('PRC-SEC-03: log de operación con PII y llave interna redacta campos sensibles', async () => {
    const ownerId = 'owner-sensitive@example.test';
    await expect(call('searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-15' }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }, internal('customer', key, ownerId))).rejects.toMatchObject({ code: 13 });
    expect(logs).not.toContain(ownerId);
    expect(logs).not.toContain(key);
    expect(logs).not.toContain('forced internal failure');
    expect(logs).toContain('[REDACTED]');
  });
});
