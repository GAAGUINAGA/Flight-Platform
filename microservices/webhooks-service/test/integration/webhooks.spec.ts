/* global __dirname, afterAll, afterEach, beforeAll, beforeEach, Buffer */
import { createServer, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { WebhookUseCases } from '../../src/application/webhook-use-cases';
import { HttpPoster, UrlPolicy } from '../../src/application/ports';
import { PrismaWebhookStore } from '../../src/infrastructure/persistence/prisma-webhook-store';
import { FetchHttpPoster } from '../../src/infrastructure/clients/fetch-http-poster';
import { AesGcmCipher } from '../../src/infrastructure/security/webhook-security';

const ownerPrefix = `webhooks-it-${randomUUID()}-`;
const system = { role: 'system', correlationId: 'integration' };
const cipher = new AesGcmCipher(Buffer.alloc(32, 3).toString('base64'));
const allowTestReceiver: UrlPolicy = { assertSafe: async () => undefined };
const payloadIsOpenApiWebhookPayload = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>; const allowed = new Set(['eventId', 'eventType', 'occurredAt', 'apiVersion', 'data']);
  if (Object.keys(p).some((key) => !allowed.has(key))) return false;
  if (Object.entries(p).some(([, item]) => item !== undefined && typeof item !== 'string' && typeof item !== 'object')) return false;
  if (p.data !== undefined && (!p.data || typeof p.data !== 'object' || Array.isArray(p.data))) return false;
  return true;
};

describe('WHK integration (WHK-03..06)', () => {
  let prisma: PrismaClient; let store: PrismaWebhookStore; let now: Date;
  const makeUseCases = (poster: HttpPoster) => new WebhookUseCases(store, allowTestReceiver, cipher, poster, { timeoutMs: 5000, backoffMinutes: [1, 5, 15, 60, 180, 720], production: false }, () => now);
  const owner = () => `${ownerPrefix}${randomUUID()}`;
  beforeAll(async () => { const env = join(__dirname, '..', '..', '.env'); if (existsSync(env)) process.loadEnvFile(env); if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for webhooks integration tests'); prisma = new PrismaClient(); await prisma.$connect(); await prisma.subscription.deleteMany({ where: { ownerId: { startsWith: 'webhooks-it-' } } }); store = new PrismaWebhookStore(prisma); });
  beforeEach(() => { now = new Date('2026-10-07T12:00:00.000Z'); });
  afterEach(async () => { await prisma.subscription.deleteMany({ where: { ownerId: { startsWith: ownerPrefix } } }); });
  afterAll(async () => { if (prisma) { await prisma.subscription.deleteMany({ where: { ownerId: { startsWith: ownerPrefix } } }); await prisma.$disconnect(); } });

  it('WHK-03: creates, masks, lists and owner-scopes deletion', async () => {
    const useCases = makeUseCases({ post: async () => 204 }); const mine = owner();
    const created = await useCases.create(system, { ownerId: mine, url: 'https://hooks.example.test/created', events: ['booking.confirmed'], secret: 'never-return-this-secret' });
    expect(created.secret).toBe('****cret');
    expect(await useCases.list(system, { ownerId: mine })).toEqual([expect.objectContaining({ id: created.id, secret: '****cret' })]);
    await expect(useCases.delete(system, { id: created.id, ownerId: owner() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.subscription.findUnique({ where: { id: created.id } })).not.toBeNull();
    await useCases.delete(system, { id: created.id, ownerId: mine });
    expect(await prisma.subscription.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('H2 / WHK-04: persists zero deliveries without subscriptions and two with two matching subscriptions', async () => {
    const useCases = makeUseCases({ post: async () => 204 }); const mine = owner();
    const noSubscriptions = await useCases.publish(system, { ownerId: mine, payload: { eventType: 'booking.confirmed' } });
    expect(await prisma.delivery.count({ where: { eventId: noSubscriptions.eventId } })).toBe(0);
    await useCases.create(system, { ownerId: mine, url: 'https://hooks.example.test/one', events: ['booking.confirmed'], secret: 'one-secret' });
    await useCases.create(system, { ownerId: mine, url: 'https://hooks.example.test/two', events: ['booking.confirmed'], secret: 'two-secret' });
    const twoSubscriptions = await useCases.publish(system, { ownerId: mine, payload: { eventType: 'booking.confirmed' } });
    expect(await prisma.delivery.count({ where: { eventId: twoSubscriptions.eventId } })).toBe(2);
  });

  it('WHK-04/05/06: posts one OpenAPI-shaped signed event to a real local receiver', async () => {
    const received: Array<{ body: string; signature?: string }> = []; let server: Server | undefined;
    const listening = new Promise<number>((resolve) => { server = createServer((request, response) => { let body = ''; request.on('data', (chunk) => { body += String(chunk); }); request.on('end', () => { received.push({ body, signature: request.headers['x-flight-signature'] as string | undefined }); response.writeHead(204); response.end(); }); }).listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port)); });
    const port = await listening; const useCases = makeUseCases(new FetchHttpPoster()); const mine = owner();
    try {
      await useCases.create(system, { ownerId: mine, url: `http://127.0.0.1:${port}/hook`, events: ['booking.confirmed'], secret: 'receiver-signing-secret' });
      const eventId = randomUUID(); await useCases.publish(system, { ownerId: mine, payload: { eventId, eventType: 'booking.confirmed', occurredAt: now.toISOString(), apiVersion: '1.5.0.0', data: { bookingId: randomUUID(), status: 'CONFIRMED' } } });
      expect(await useCases.dispatch(system, {})).toBe(1); expect(received).toHaveLength(1);
      const payload = JSON.parse(received[0].body) as Record<string, unknown>; expect(payloadIsOpenApiWebhookPayload(payload)).toBe(true); expect(payload).toMatchObject({ eventId, eventType: 'booking.confirmed', apiVersion: '1.5.0.0' });
      expect(received[0].signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/); expect(await prisma.delivery.findFirst({ where: { eventId } })).toMatchObject({ status: 'DELIVERED', attempts: 0 });
    } finally { await new Promise<void>((resolve) => server?.close(() => resolve())); }
  });

  it('WHK-05: applies the configured retry schedule with a fixed clock', async () => {
    const useCases = makeUseCases({ post: async () => 503 }); const mine = owner(); await useCases.create(system, { ownerId: mine, url: 'https://hooks.example.test/retry', events: ['booking.confirmed'], secret: 'retry-secret' });
    const { eventId } = await useCases.publish(system, { ownerId: mine, payload: { eventType: 'booking.confirmed' } }); await useCases.dispatch(system, {});
    let delivery = await prisma.delivery.findFirstOrThrow({ where: { eventId } }); expect(delivery).toMatchObject({ status: 'PENDING', attempts: 1, nextAttemptAt: new Date(now.getTime() + 60_000) });
    now = delivery.nextAttemptAt; await useCases.dispatch(system, {}); delivery = await prisma.delivery.findFirstOrThrow({ where: { eventId } }); expect(delivery).toMatchObject({ status: 'PENDING', attempts: 2, nextAttemptAt: new Date(now.getTime() + 5 * 60_000) });
    for (const minutes of [15, 60, 180, 720]) { now = delivery.nextAttemptAt; await useCases.dispatch(system, {}); delivery = await prisma.delivery.findFirstOrThrow({ where: { eventId } }); expect(delivery).toMatchObject({ status: 'PENDING', attempts: expect.any(Number), nextAttemptAt: new Date(now.getTime() + minutes * 60_000) }); }
    expect(delivery).toMatchObject({ attempts: 6, nextAttemptAt: new Date(now.getTime() + 720 * 60_000) }); now = delivery.nextAttemptAt; await useCases.dispatch(system, {}); expect(await prisma.delivery.findFirstOrThrow({ where: { eventId } })).toMatchObject({ status: 'FAILED', attempts: 7 });
  });

  it('WHK-05: claims a pending delivery once under concurrent dispatchers', async () => {
    const mine = owner(); const useCases = makeUseCases({ post: async () => 204 }); await useCases.create(system, { ownerId: mine, url: 'https://hooks.example.test/concurrent', events: ['booking.confirmed'], secret: 'concurrent-secret' }); const { eventId } = await useCases.publish(system, { ownerId: mine, payload: { eventType: 'booking.confirmed' } });
    const [left, right] = await Promise.all([store.claimPending(now, 100, 10_000), store.claimPending(now, 100, 10_000)]); expect(left.length + right.length).toBe(1); expect((await prisma.delivery.findFirstOrThrow({ where: { eventId } })).status).toBe('PROCESSING');
  });

  it('reclaims PROCESSING deliveries after two request timeouts', async () => {
    const mine = owner(); const useCases = makeUseCases({ post: async () => 204 }); await useCases.create(system, { ownerId: mine, url: 'https://hooks.example.test/stale', events: ['booking.confirmed'], secret: 'stale-secret' }); const { eventId } = await useCases.publish(system, { ownerId: mine, payload: { eventType: 'booking.confirmed' } });
    expect(await store.claimPending(now, 100, 10_000)).toHaveLength(1); expect(await store.claimPending(new Date(now.getTime() + 9_999), 100, 10_000)).toHaveLength(0); expect(await store.claimPending(new Date(now.getTime() + 10_001), 100, 10_000)).toHaveLength(1); expect((await prisma.delivery.findFirstOrThrow({ where: { eventId } })).status).toBe('PROCESSING');
  });

  it('treats a redirect as a failed delivery and never follows its target', async () => {
    let redirectedRequests = 0; const target = createServer((_request, response) => { redirectedRequests += 1; response.writeHead(204); response.end(); }); await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve)); const targetPort = (target.address() as { port: number }).port;
    const redirector = createServer((_request, response) => { response.writeHead(302, { location: `http://127.0.0.1:${targetPort}/private` }); response.end(); }); await new Promise<void>((resolve) => redirector.listen(0, '127.0.0.1', resolve)); const redirectPort = (redirector.address() as { port: number }).port;
    const mine = owner(); const useCases = makeUseCases(new FetchHttpPoster());
    try { await useCases.create(system, { ownerId: mine, url: `http://127.0.0.1:${redirectPort}/redirect`, events: ['booking.confirmed'], secret: 'redirect-secret' }); const { eventId } = await useCases.publish(system, { ownerId: mine, payload: { eventType: 'booking.confirmed' } }); await useCases.dispatch(system, {}); expect(redirectedRequests).toBe(0); expect(await prisma.delivery.findFirstOrThrow({ where: { eventId } })).toMatchObject({ status: 'PENDING', attempts: 1 }); } finally { await new Promise<void>((resolve) => redirector.close(() => resolve())); await new Promise<void>((resolve) => target.close(() => resolve())); }
  });
});
