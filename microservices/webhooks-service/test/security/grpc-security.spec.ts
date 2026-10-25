/* global afterAll, beforeAll */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { WebhookStore } from '../../src/application/ports';
import { createWebhooksServer, findProtoRoot } from '../../src/infrastructure/grpc/server';
import { Delivery, Subscription } from '../../src/domain/webhook';

const internalKey = 'k'.repeat(40);
const encryptionKey = Buffer.alloc(32, 5).toString('base64');
const brokenStore: WebhookStore = {
  createSubscription: async (input: Subscription) => input,
  listSubscriptions: async () => { throw new Error('forced internal implementation detail'); },
  deleteSubscription: async () => false,
  activeFor: async () => [], getSubscription: async () => null,
  createDeliveries: async () => undefined,
  claimPending: async () => [] as Delivery[],
  delivered: async () => undefined,
  failed: async () => undefined
};

describe('WHK-SEC-05 gRPC security baseline', () => {
  let app: Awaited<ReturnType<typeof createWebhooksServer>>; let client: Record<string, (...args: unknown[]) => void>;
  const call = <T>(method: string, request: unknown, metadata?: Metadata) => new Promise<T>((resolve, reject) => client[method](request, metadata ?? new Metadata(), (error: ServiceError | null, response: T) => error ? reject(error) : resolve(response)));
  beforeAll(async () => { const port = 43000 + Math.floor(Math.random() * 1000); app = await createWebhooksServer({ url: `127.0.0.1:${port}`, internalApiKey: internalKey, encryptionKey, prisma: new PrismaClient(), store: brokenStore, production: false }); await app.listen(); const root = findProtoRoot(); const definition = loadSync(join(root, 'flightplatform/webhooks/v1/webhooks.proto'), { includeDirs: [root], keepCase: false, defaults: true, arrays: true, objects: true }); const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { webhooks: { v1: { WebhooksService: new (address: string, credentials: unknown) => typeof client } } } }; client = new pkg.flightplatform.webhooks.v1.WebhooksService(`127.0.0.1:${port}`, credentials.createInsecure()); });
  afterAll(async () => { (client as unknown as { close?: () => void } | undefined)?.close?.(); await app?.close(); });
  const metadata = (role?: string) => { const value = new Metadata(); value.set('x-internal-key', internalKey); if (role) value.set('x-role', role); return value; };
  it('rejects a missing internal key, customer dispatch and malformed RPC input', async () => {
    await expect(call('ListSubscriptions', { ownerId: 'owner' })).rejects.toMatchObject({ code: 16, details: 'UNAUTHENTICATED' });
    await expect(call('DispatchPending', {}, metadata('customer'))).rejects.toMatchObject({ code: 7, details: 'PERMISSION_DENIED' });
    await expect(call('DeleteSubscription', { id: 'not-a-uuid', ownerId: 'owner' }, metadata('system'))).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });
  it('WHK-VAL-02 / F11d-1: rechaza data adicional, conserva GUID sin variante RFC y rechaza UUID malformado', async () => {
    await expect(call('PublishEvent', { ownerId: 'owner', payload: { eventType: 'hold.expired', data: { status: 'EXPIRED', additional: 'no' } } }, metadata('system'))).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    await expect(call('PublishEvent', { ownerId: 'owner', payload: { eventId: '11111111-1111-1111-1111-111111111111', eventType: 'hold.expired', occurredAt: '2026-10-24T00:00:00.000Z', apiVersion: '1.5.0.0', data: { status: 'EXPIRED', holdId: 'hold-123' } } }, metadata('system'))).resolves.toEqual(expect.objectContaining({ eventId: expect.any(String) }));
    await expect(call('PublishEvent', { ownerId: 'owner', payload: { eventId: 'not-a-uuid', eventType: 'hold.expired', data: { status: 'EXPIRED' } } }, metadata('system'))).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });
  it('F11d-1 / ADR-F11-16: occurredAt sin segundos o con +0200 es VALIDATION_FAILED; con +02:00 se acepta', async () => {
    const publish = (occurredAt: string) => call('PublishEvent', { ownerId: 'owner', payload: { eventId: '11111111-1111-1111-1111-111111111111', eventType: 'hold.expired', occurredAt, apiVersion: '1.5.0.0', data: { status: 'EXPIRED' } } }, metadata('system'));
    await expect(publish('2026-10-24T00:00Z')).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    await expect(publish('2026-10-24T00:00:00+0200')).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    await expect(publish('2026-10-24T00:00:00+02:00')).resolves.toEqual(expect.objectContaining({ eventId: expect.any(String) }));
  });
  it('maps an internal failure to a generic error without the implementation detail', async () => {
    await expect(call('ListSubscriptions', { ownerId: `owner-${randomUUID()}` }, metadata('customer'))).rejects.toMatchObject({ code: 13, details: 'INTERNAL_ERROR' });
  });
});
