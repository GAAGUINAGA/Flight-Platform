/* global __dirname, afterAll, beforeAll, Buffer, fetch */
// Punta a punta con RabbitMQ y Postgres reales (condición 2 de ADR-F12b2-01):
// emisor REAL (operations-service con ESB_URL) → ESB real (outbox en `esb`) → RabbitMQ → Webhooks real (consumo por lotes, `webhooks`) → feed y entrega firmada v1 y v2.
// Carga el .env del ESB y el de Webhooks con dotenv.parse (sin tocar process.env, sin imprimir valores): la ejecuta el humano o el auditor (regla de AGENTS.md).
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { parse } from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import { createOperationsRuntime } from '../../../operations-service/src/main';
import { PrismaClient as WebhooksPrisma } from '../../../webhooks-service/src/infrastructure/persistence/prisma-client/client';
import { PrismaWebhookStore } from '../../../webhooks-service/src/infrastructure/persistence/prisma-webhook-store';
import { AesGcmCipher } from '../../../webhooks-service/src/infrastructure/security/webhook-security';
import { AmqpEventBusConsumer } from '../../../webhooks-service/src/infrastructure/events/amqp-event-bus-consumer';
import { WebhookUseCases } from '../../../webhooks-service/src/application/webhook-use-cases';
import { createEsbApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { WEBHOOKS_QUEUE } from '../../src/domain/events';
import { PrismaClient as EsbPrisma } from '../../src/infrastructure/persistence/prisma-client/client';
import { FakeInvoker, FakeProbe, MemoryLogger } from '../unit/fakes';

const read = (file: string): Record<string, string> => (existsSync(file) ? parse(readFileSync(file)) : {});
const run = `e2ebus${randomUUID().slice(0, 8)}`;
const system = { role: 'system', correlationId: 'bus-e2e' };
const secretV1 = 'e2e-secret-v1'; const secretV2 = 'e2e-secret-v2';
const savedEnv: Record<string, string | undefined> = {};

describe('BUS-E2E (RabbitMQ y Postgres reales): operations → ESB → bus → Webhooks → feed y entrega firmada', () => {
  let esb: INestApplication; let esbBase: string; let esbPrisma: EsbPrisma; let whPrisma: WebhooksPrisma; let useCases: WebhookUseCases;
  const key = randomBytes(24).toString('hex');
  const posts: Array<{ body: string; headers: Record<string, string> }> = [];
  let rabbit = ''; let close: () => void = () => undefined;

  beforeAll(async () => {
    const esbEnv = read(join(__dirname, '..', '..', '.env')); const whEnv = read(join(__dirname, '..', '..', '..', 'webhooks-service', '.env'));
    for (const [name, value] of [['esb DATABASE_URL', esbEnv.DATABASE_URL], ['esb RABBITMQ_URL', esbEnv.RABBITMQ_URL], ['webhooks DATABASE_URL', whEnv.DATABASE_URL], ['webhooks RABBITMQ_URL', whEnv.RABBITMQ_URL]]) if (!value) throw new Error(`${name} is required for the bus end-to-end test`);
    rabbit = whEnv.RABBITMQ_URL;
    const config = loadConfig({ INTERNAL_API_KEY: key, INTEGRATION_LOCAL: 'true', ESB_EVENTS_MODE: 'outbox', DATABASE_URL: esbEnv.DATABASE_URL, RABBITMQ_URL: esbEnv.RABBITMQ_URL });
    esb = await createEsbApp(config, { invoker: new FakeInvoker(), probe: new FakeProbe(), logger: new MemoryLogger() });
    await esb.listen(0, '127.0.0.1'); esbBase = `http://127.0.0.1:${(esb.getHttpServer().address() as AddressInfo).port}`;
    esbPrisma = new EsbPrisma({ datasources: { db: { url: esbEnv.DATABASE_URL } } }); await esbPrisma.$connect();
    whPrisma = new WebhooksPrisma({ datasources: { db: { url: whEnv.DATABASE_URL } } }); await whPrisma.$connect();
    const store = new PrismaWebhookStore(whPrisma);
    useCases = new WebhookUseCases(store, { assertSafe: async () => undefined }, new AesGcmCipher(Buffer.alloc(32, 3).toString('base64')), { post: async (_url, body, headers) => { posts.push({ body, headers }); return 204; } },
      { timeoutMs: 5000, backoffMinutes: [1], production: false, sourceCode: 'gabatair', events: { queue: WEBHOOKS_QUEUE, maxAttempts: 3, pullBatch: 100, pullMaxBatches: 5, pullBudgetMs: 30_000 } }, () => new Date(), store, new AmqpEventBusConsumer(whEnv.RABBITMQ_URL, WEBHOOKS_QUEUE, 3000));
    // El emisor real se compone como en producción: con ESB_URL apuntando al ESB (el valor anterior se restaura al terminar).
    for (const name of ['ESB_URL', 'INTERNAL_API_KEY']) savedEnv[name] = process.env[name];
    process.env.ESB_URL = esbBase; process.env.INTERNAL_API_KEY = key;
  }, 90_000);
  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    close();
    try {
      await esbPrisma?.outboxEvent.deleteMany({ where: { ownerId: { startsWith: run } } });
      await whPrisma?.event.deleteMany({ where: { ownerId: { startsWith: run } } }); await whPrisma?.subscription.deleteMany({ where: { ownerId: { startsWith: run } } });
    } finally { await esb?.close(); await esbPrisma?.$disconnect(); await whPrisma?.$disconnect(); }
  }, 60_000);

  it('BUS-E2E-1: un evento emitido por operations llega por outbox y bus a Webhooks, queda en el feed y se entrega firmado en v1 y v2', async () => {
    const owner = `${run}-owner`; const bookingId = randomUUID();
    await useCases.create(system, { ownerId: owner, url: 'https://hooks.example.test/e2e-v1', events: ['booking.checked_in'], secret: secretV1 });
    await useCases.create(system, { ownerId: owner, url: 'https://hooks.example.test/e2e-v2', events: ['booking.checked_in'], secret: secretV2, apiVersion: '2' });

    // 1) Emisor real (composición de producción de operations-service con ESB_URL).
    const operations = createOperationsRuntime(key, {} as never);
    close = operations.close;
    await operations.runtime.events.publish({ ownerId: owner, bookingId, pnr: 'E2E123', eventType: 'booking.checked_in', occurredAt: new Date().toISOString() });
    const stored = await esbPrisma.outboxEvent.findMany({ where: { ownerId: owner } });
    expect(stored).toHaveLength(1); expect(stored[0]).toMatchObject({ status: 'PENDING', routingKey: 'booking.checked_in' });

    // 2) El scheduler del Gateway dispara la publicación de la outbox (operación nativa del ESB, rol system).
    const published = await fetch(`${esbBase}/internal/v1/operations/sistema.publicar-eventos`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': key, 'x-role': 'system', 'x-correlation-id': 'bus-e2e' }, body: JSON.stringify({ input: {} }) });
    const outcome = await published.json() as { ok: boolean; result: { published: number; brokerAvailable: boolean } };
    expect(outcome).toMatchObject({ ok: true, result: { brokerAvailable: true } }); expect(outcome.result.published).toBeGreaterThanOrEqual(1);
    expect((await esbPrisma.outboxEvent.findMany({ where: { ownerId: owner } }))[0]).toMatchObject({ status: 'PUBLISHED', lockedUntil: null });

    // 3) Webhooks retira el lote del bus, registra el evento y entrega.
    expect(await useCases.dispatch(system, {})).toBeGreaterThanOrEqual(2);

    // Feed (GET /vuelos/eventos lee listEvents): el evento está, con el pnr y el bookingId.
    const feed = await useCases.listEvents(system, { ownerPrefix: owner });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ eventType: 'booking.checked_in', ownerId: owner, apiVersion: '1.5.0.0' });
    expect(JSON.parse(feed.items[0].dataJson)).toMatchObject({ bookingId, pnr: 'E2E123' });

    // Entrega v1: cuerpo de cinco propiedades y x-flight-signature.
    const v1 = posts.find((post) => post.headers['x-flight-signature'] && post.body.includes(bookingId));
    if (!v1) throw new Error('v1 delivery not found');
    const parts = v1.headers['x-flight-signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(parts![2]).toBe(createHmac('sha256', secretV1).update(`${parts![1]}.${v1.body}`).digest('hex'));
    expect(Object.keys(JSON.parse(v1.body) as object)).toEqual(['eventId', 'eventType', 'occurredAt', 'apiVersion', 'data']);

    // Entrega v2: CloudEvents con id evt-vue-<seq>, correlationid y X-Webhook-Signature = HMAC-SHA256 del cuerpo.
    const v2 = posts.find((post) => post.headers['x-webhook-signature'] && post.body.includes(bookingId));
    if (!v2) throw new Error('v2 delivery not found');
    expect(v2.headers['x-webhook-signature']).toBe(`sha256=${createHmac('sha256', secretV2).update(v2.body).digest('hex')}`);
    expect(JSON.parse(v2.body)).toMatchObject({ specversion: '1.0', type: 'ec.edu.epn.booking.vuelos.booking.checked_in', id: `evt-vue-${String(feed.items[0].seq).padStart(6, '0')}`, correlationid: feed.items[0].eventId, subject: bookingId, data: { bookingId, pnr: 'E2E123' } });
    expect(rabbit).not.toBe('');
  }, 60_000);
});
