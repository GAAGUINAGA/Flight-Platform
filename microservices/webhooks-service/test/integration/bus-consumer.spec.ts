/* global __dirname, afterAll, beforeAll, Buffer */
// Integración del consumo por lotes con RabbitMQ y Postgres reales (local). Usa el .env de Webhooks (DATABASE_URL, RABBITMQ_URL) sin imprimirlo.
// El productor es el adaptador real del ESB (solo se importa su código; no usa su base ni su .env). Exchange y colas propios de la ejecución.
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import amqp from 'amqplib';
import { parse } from 'dotenv';
import type { OutboxRow } from '../../../esb-service/src/application/event-ports';
import { buildEnvelope, topologyFor, WEBHOOKS_FAILED_QUEUE, WEBHOOKS_QUEUE, waitQueueName as esbWaitQueue, type EventPayload } from '../../../esb-service/src/domain/events';
import { AmqpEventBus } from '../../../esb-service/src/infrastructure/events/amqp-event-bus';
import { EventLog, UrlPolicy, WebhookStore } from '../../src/application/ports';
import { EventIngestConfig, WebhookUseCases } from '../../src/application/webhook-use-cases';
import { DEFAULT_EVENTS_QUEUE, failedQueueName, waitQueueName } from '../../src/domain/event-retry';
import { AmqpEventBusConsumer } from '../../src/infrastructure/events/amqp-event-bus-consumer';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaWebhookStore } from '../../src/infrastructure/persistence/prisma-webhook-store';
import { AesGcmCipher } from '../../src/infrastructure/security/webhook-security';

const system = { role: 'system', correlationId: 'bus-it' };
const allow: UrlPolicy = { assertSafe: async () => undefined };
const run = `whbus${randomUUID().slice(0, 8)}`;
const QUEUE = `it-${run}.q`; const EXCHANGE = `it-${run}.x`; const FAILED = failedQueueName(QUEUE);
const topology = topologyFor(QUEUE, ['booking.#'], [150, 150, 150], EXCHANGE);
const ingestConfig: EventIngestConfig = { queue: QUEUE, maxAttempts: 3, pullBatch: 20, pullMaxBatches: 5, pullBudgetMs: 30_000 };
const secret = 'bus-integration-secret';

describe('BUS-I (RabbitMQ y Postgres reales): consumo por lotes de Webhooks', () => {
  let prisma: PrismaClient; let store: PrismaWebhookStore; let url: string; let admin: Awaited<ReturnType<typeof amqp.connect>>; let channel: Awaited<ReturnType<typeof admin.createChannel>>;
  let posts: Array<{ url: string; body: string; headers: Record<string, string> }>; let producer: AmqpEventBus;
  const cipher = new AesGcmCipher(Buffer.alloc(32, 9).toString('base64'));
  const useCasesFor = (overrides: { store?: WebhookStore & EventLog; queue?: string } = {}) => new WebhookUseCases(overrides.store ?? store, allow, cipher, { post: async (target, body, headers) => { posts.push({ url: target, body, headers }); return 204; } }, { timeoutMs: 5000, backoffMinutes: [1], production: false, sourceCode: 'gabatair', events: { ...ingestConfig, queue: overrides.queue ?? QUEUE } }, () => new Date(), overrides.store ?? store, new AmqpEventBusConsumer(url, overrides.queue ?? QUEUE, 3000));
  const payload = (ownerId: string, over: Partial<EventPayload> = {}): { ownerId: string; payload: EventPayload } => ({ ownerId, payload: { eventId: randomUUID(), eventType: 'booking.confirmed', occurredAt: new Date().toISOString(), apiVersion: 'v1', correlationId: `corr-${run}`, data: { bookingId: randomUUID(), pnr: 'ABC123', status: 'CONFIRMED' }, ...over } });
  let seq = 1_000_000_000;
  const publish = async (items: Array<{ ownerId: string; payload: EventPayload }>): Promise<void> => {
    const session = await producer.open();
    try {
      const rows: OutboxRow[] = items.map((item) => ({ seq: (seq += 1), eventId: item.payload.eventId, routingKey: item.payload.eventType, envelope: buildEnvelope(item.ownerId, item.payload), attempts: 1 }));
      const report = await session.publish(rows); if (report.failed.length) throw new Error('producer could not publish');
    } finally { await session.close(); }
  };
  const count = async (queue: string): Promise<number> => (await channel.checkQueue(queue)).messageCount;
  const subscribe = (ownerId: string) => useCasesFor().create(system, { ownerId, url: 'https://hooks.example.test/bus', events: ['booking.confirmed'], secret });

  beforeAll(async () => {
    const values = existsSync(join(__dirname, '..', '..', '.env')) ? parse(readFileSync(join(__dirname, '..', '..', '.env'))) : {};
    const databaseUrl = values.DATABASE_URL ?? process.env.DATABASE_URL; if (!databaseUrl) throw new Error('DATABASE_URL is required for webhooks bus integration tests');
    if (!(values.RABBITMQ_URL ?? process.env.RABBITMQ_URL)) throw new Error('RABBITMQ_URL is required for webhooks bus integration tests');
    url = (values.RABBITMQ_URL ?? process.env.RABBITMQ_URL)!;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } }); await prisma.$connect(); store = new PrismaWebhookStore(prisma);
    producer = new AmqpEventBus(url, topology, 3000); await (await producer.open()).close();
    admin = await amqp.connect(url); admin.on('error', () => undefined); channel = await admin.createChannel();
  }, 60_000);
  afterAll(async () => {
    try {
      if (prisma) { await prisma.event.deleteMany({ where: { ownerId: { startsWith: run } } }); await prisma.subscription.deleteMany({ where: { ownerId: { startsWith: run } } }); }
      if (channel) { for (const queue of topology.queues) await channel.deleteQueue(queue.name).catch(() => undefined); await channel.deleteExchange(EXCHANGE).catch(() => undefined); }
    } finally { await admin?.close().catch(() => undefined); await prisma?.$disconnect(); }
  }, 60_000);

  it('BUS-I11: los nombres de la topología coinciden entre el ESB y Webhooks', () => {
    expect(DEFAULT_EVENTS_QUEUE).toBe(WEBHOOKS_QUEUE);
    expect(failedQueueName(WEBHOOKS_QUEUE)).toBe(WEBHOOKS_FAILED_QUEUE);
    for (const step of [1, 2, 3]) expect(waitQueueName(WEBHOOKS_QUEUE, step)).toBe(esbWaitQueue(WEBHOOKS_QUEUE, step));
    expect(topology.queues.map((queue) => queue.name)).toEqual([QUEUE, waitQueueName(QUEUE, 1), waitQueueName(QUEUE, 2), waitQueueName(QUEUE, 3), FAILED]);
  });

  it('BUS-I2: dispatch retira el lote, registra los eventos (feed), crea las entregas, las firma (v1) y deja la cola vacía', async () => {
    posts = []; const owner = `${run}-i2`; const sub = await subscribe(owner);
    const items = [payload(owner), payload(owner), payload(owner)]; await publish(items);
    expect(await count(QUEUE)).toBe(3);
    // dispatch entrega todas las entregas pendientes de la base: puede haber restos de otras ejecuciones, por eso solo se exige un mínimo.
    expect(await useCasesFor().dispatch(system, {})).toBeGreaterThanOrEqual(3);
    expect(await count(QUEUE)).toBe(0);
    const events = await prisma.event.findMany({ where: { ownerId: owner }, orderBy: { seq: 'asc' } });
    expect(events.map((event) => event.eventId)).toEqual(items.map((item) => item.payload.eventId));
    expect(events[0]).toMatchObject({ eventType: 'booking.confirmed', apiVersion: 'v1', correlationId: `corr-${run}` });
    expect((await prisma.delivery.findMany({ where: { subscriptionId: sub.id } })).map((delivery) => delivery.status)).toEqual(['DELIVERED', 'DELIVERED', 'DELIVERED']);
    expect(posts).toHaveLength(3);
    const [first] = posts; const timestamp = first.headers['x-flight-signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(timestamp).not.toBeNull();
    expect(timestamp![2]).toBe(createHmac('sha256', secret).update(`${timestamp![1]}.${first.body}`).digest('hex'));
    expect(JSON.parse(first.body)).toMatchObject({ eventType: 'booking.confirmed', apiVersion: 'v1', data: { pnr: 'ABC123' } });
  });

  it('BUS-I3: el mismo evento dos veces (mensaje duplicado) deja un evento y una entrega por suscripción', async () => {
    posts = []; const owner = `${run}-i3`; const sub = await subscribe(owner); const same = payload(owner);
    await publish([same, same]);
    expect(await useCasesFor().dispatch(system, {})).toBeGreaterThanOrEqual(1);
    expect(await prisma.event.count({ where: { eventId: same.payload.eventId } })).toBe(1);
    expect(await prisma.delivery.count({ where: { subscriptionId: sub.id } })).toBe(1);
    expect(posts.filter((post) => post.body.includes(same.payload.eventId))).toHaveLength(1); expect(await count(QUEUE)).toBe(0);
  });

  it('BUS-I4: un fallo transitorio pasa por las esperas 1, 2 y 3 (TTL) y termina en fallidos con x-intento y x-motivo', async () => {
    const owner = `${run}-i4`; await subscribe(owner); const item = payload(owner); await publish([item]);
    const failing: WebhookStore & EventLog = Object.create(store, { activeFor: { value: async () => { throw new Error('db down'); } } }) as WebhookStore & EventLog;
    const useCases = useCasesFor({ store: failing });
    for (let round = 0; round < 4; round += 1) { await useCases.ingest(system); await sleep(450); }
    expect(await count(QUEUE)).toBe(0); for (let step = 1; step <= 3; step += 1) expect(await count(waitQueueName(QUEUE, step))).toBe(0);
    expect(await count(FAILED)).toBe(1);
    const failed = await channel.get(FAILED, { noAck: true });
    if (!failed) throw new Error('failed queue is empty');
    expect(failed.properties.headers).toMatchObject({ 'x-intento': 3, 'x-motivo': 'INGEST_FAILED' });
    expect(JSON.parse(failed.content.toString('utf8'))).toMatchObject({ id: item.payload.eventId });
  }, 30_000);

  it('BUS-I4: tras un fallo transitorio, el reintento ingresa el evento una vez que la dependencia vuelve', async () => {
    posts = []; const owner = `${run}-i4b`; await subscribe(owner); const item = payload(owner); await publish([item]);
    let down = true; const flaky: WebhookStore & EventLog = Object.create(store, { activeFor: { value: async (...args: [string, string]) => { if (down) throw new Error('db down'); return store.activeFor(...args); } } }) as WebhookStore & EventLog;
    const useCases = useCasesFor({ store: flaky });
    expect(await useCases.ingest(system)).toMatchObject({ retried: 1, ingested: 0 });
    down = false; await sleep(450);
    expect(await useCases.ingest(system)).toMatchObject({ ingested: 1 });
    expect(await prisma.delivery.count({ where: { eventId: item.payload.eventId } })).toBe(1);
    expect(await count(FAILED)).toBe(0);
  }, 30_000);

  it('BUS-I5: un evento fuera de la lista y un cuerpo que no es CloudEvents van directo a fallidos, sin reintento', async () => {
    const before = await count(FAILED); const owner = `${run}-i5`;
    await channel.publish(EXCHANGE, 'booking.desconocido', Buffer.from(JSON.stringify(buildEnvelope(owner, { eventId: randomUUID(), eventType: 'booking.desconocido', occurredAt: new Date().toISOString() }))), { persistent: true });
    await channel.publish(EXCHANGE, 'booking.basura', Buffer.from('no es json'), { persistent: true });
    await sleep(100);
    expect(await useCasesFor().ingest(system)).toMatchObject({ ingested: 0, failed: 2, retried: 0 });
    expect(await count(FAILED)).toBe(before + 2);
    const reasons: unknown[] = []; for (let i = 0; i < before + 2; i += 1) { const message = await channel.get(FAILED, { noAck: true }); if (message) reasons.push(message.properties.headers?.['x-motivo']); }
    expect(reasons).toEqual(expect.arrayContaining(['VALIDATION_FAILED', 'INVALID_ENVELOPE']));
    expect(await prisma.event.count({ where: { ownerId: owner } })).toBe(0);
  });

  it('BUS-I8: dos consumidores concurrentes procesan cada mensaje una sola vez', async () => {
    await channel.purgeQueue(FAILED); posts = []; const owner = `${run}-i8`; const sub = await subscribe(owner);
    const items = Array.from({ length: 40 }, () => payload(owner)); await publish(items);
    const a = useCasesFor(); const b = useCasesFor();
    const [x, y] = await Promise.all([a.ingest(system), b.ingest(system)]);
    expect(x.ingested + y.ingested).toBe(40);
    expect(await count(QUEUE)).toBe(0);
    expect(await prisma.event.count({ where: { ownerId: owner } })).toBe(40);
    expect(await prisma.delivery.count({ where: { subscriptionId: sub.id } })).toBe(40);
  }, 60_000);

  it('BUS-I8: una cola que aún no existe se trata como lote vacío (sin error) y dispatch sigue entregando', async () => {
    const useCases = useCasesFor({ queue: `${QUEUE}.no-existe` });
    expect(await useCases.ingest(system)).toEqual({ ingested: 0, retried: 0, failed: 0 });
    await expect(useCases.dispatch(system, {})).resolves.toBeGreaterThanOrEqual(0);
  });

  it('BUS-I6: con el broker caído dispatch no falla y entrega lo que ya estaba pendiente', async () => {
    posts = []; const owner = `${run}-i6`; await subscribe(owner);
    const direct = useCasesFor(); await direct.publish(system, payload(owner));
    const down = new WebhookUseCases(store, allow, cipher, { post: async (target, body, headers) => { posts.push({ url: target, body, headers }); return 204; } }, { timeoutMs: 5000, backoffMinutes: [1], production: false, events: ingestConfig }, () => new Date(), store, new AmqpEventBusConsumer('amqp://127.0.0.1:1', QUEUE, 500));
    await expect(down.dispatch(system, {})).resolves.toBeGreaterThanOrEqual(1);
    expect(posts.length).toBeGreaterThanOrEqual(1);
  });
});
