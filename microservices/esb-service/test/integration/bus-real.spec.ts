/* global __dirname, afterAll, beforeAll */
// Integración del bus con RabbitMQ y Postgres reales (local). Usa el .env del propio ESB (DATABASE_URL de svc_esb y RABBITMQ_URL) sin imprimirlo.
// Aislamiento: exchange y cola propios de la ejecución; solo toca filas de la outbox con el dueño de esta ejecución.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, connect as tcpConnect, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import amqp from 'amqplib';
import { parse } from 'dotenv';
import { DEFAULT_EVENT_LIMITS, OutboxEventOperations, type EventLimits } from '../../src/application/event-operations';
import type { BusSession, EventBus, OutboxRow } from '../../src/application/event-ports';
import { topologyFor, type Topology } from '../../src/domain/events';
import { AmqpEventBus } from '../../src/infrastructure/events/amqp-event-bus';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaEventOutbox } from '../../src/infrastructure/persistence/prisma-event-outbox';

const run = `bus${randomUUID().slice(0, 8)}`;
const owner = `${run}-owner`;
const QUEUE = `it-${run}.q`; const EXCHANGE = `it-${run}.x`;
const TTLS = [150, 150, 150];
const topology: Topology = topologyFor(QUEUE, ['booking.#'], TTLS, EXCHANGE);
const farFuture = (): Date => new Date(Date.now() + 120_000);
const id = (): string => randomUUID();

describe('BUS-I (RabbitMQ y Postgres reales): outbox del ESB', () => {
  let prisma: PrismaClient; let outbox: PrismaEventOutbox; let url: string; let admin: Awaited<ReturnType<typeof amqp.connect>>; let channel: Awaited<ReturnType<typeof admin.createChannel>>;
  const make = (limits: Partial<EventLimits> = {}, bus?: EventBus, clock: () => Date = () => new Date()) => new OutboxEventOperations(outbox, bus ?? new AmqpEventBus(url, topology, 3000), { ...DEFAULT_EVENT_LIMITS, ...limits }, clock);
  const event = (eventType = 'booking.confirmed') => ({ ownerId: owner, payload: { eventId: id(), eventType, occurredAt: new Date().toISOString(), apiVersion: 'v1', correlationId: `corr-${run}`, data: { bookingId: 'b-1', pnr: 'ABC123', status: 'CONFIRMED' } } });
  const queueCount = async (): Promise<number> => (await channel.checkQueue(QUEUE)).messageCount;
  const rows = () => prisma.outboxEvent.findMany({ where: { ownerId: owner }, orderBy: { seq: 'asc' } });
  const drain = async (): Promise<Array<{ id: string; body: { id: string } }>> => { const out = []; for (;;) { const message = await channel.get(QUEUE, { noAck: true }); if (!message) return out; out.push({ id: message.properties.messageId as string, body: JSON.parse(message.content.toString('utf8')) as { id: string } }); } };
  const reset = async (): Promise<void> => { await prisma.outboxEvent.deleteMany({ where: { ownerId: owner } }); await channel.purgeQueue(QUEUE); };

  beforeAll(async () => {
    const values = existsSync(join(__dirname, '..', '..', '.env')) ? parse(readFileSync(join(__dirname, '..', '..', '.env'))) : {};
    const databaseUrl = values.DATABASE_URL ?? process.env.DATABASE_URL; if (!databaseUrl) throw new Error('DATABASE_URL is required for ESB bus integration tests');
    if (!(values.RABBITMQ_URL ?? process.env.RABBITMQ_URL)) throw new Error('RABBITMQ_URL is required for ESB bus integration tests');
    url = (values.RABBITMQ_URL ?? process.env.RABBITMQ_URL)!;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } }); await prisma.$connect(); outbox = new PrismaEventOutbox(prisma);
    // Las filas pendientes de otra parte (la plataforma local) serían publicadas al exchange de prueba y se perderían para su cola real.
    const foreign = await prisma.outboxEvent.count({ where: { status: 'PENDING', NOT: { ownerId: { startsWith: 'bus' } } } });
    if (foreign > 0) throw new Error('The outbox has pending events from outside this test: stop the local platform and drain the outbox first');
    admin = await amqp.connect(url); admin.on('error', () => undefined); channel = await admin.createChannel();
    const session = await new AmqpEventBus(url, topology, 3000).open(); await session.close();
  }, 60_000);
  afterAll(async () => {
    try { await prisma?.outboxEvent.deleteMany({ where: { ownerId: { startsWith: run } } }); } finally {
      try {
        if (channel) { for (const queue of topology.queues) await channel.deleteQueue(queue.name).catch(() => undefined); await channel.deleteExchange(EXCHANGE).catch(() => undefined); }
      } finally { await admin?.close().catch(() => undefined); await prisma?.$disconnect(); }
    }
  }, 60_000);

  it('BUS-I1: la publicación deja N mensajes persistentes en la cola con messageId, correlación y el sobre CloudEvents; las filas pasan a PUBLISHED', async () => {
    await reset(); const ops = make();
    const sent = Array.from({ length: 5 }, () => event()); for (const item of sent) await ops.ingest(item);
    expect(await ops.publishOutbox(farFuture())).toMatchObject({ claimed: 5, published: 5, pending: 0, brokerAvailable: true });
    expect(await queueCount()).toBe(5);
    const message = await channel.get(QUEUE, { noAck: false });
    if (!message) throw new Error('queue is empty');
    expect(message.properties).toMatchObject({ deliveryMode: 2, messageId: sent[0].payload.eventId, type: 'booking.confirmed', contentType: 'application/cloudevents+json' });
    expect(message.properties.headers).toMatchObject({ 'x-correlation-id': `corr-${run}`, 'x-intento': 0 });
    expect(JSON.parse(message.content.toString('utf8'))).toMatchObject({ specversion: '1.0', id: sent[0].payload.eventId, type: 'ec.edu.epn.booking.vuelos.booking.confirmed', correlationid: `corr-${run}`, data: { ownerId: owner, payload: { eventId: sent[0].payload.eventId } } });
    channel.nack(message, false, true);
    expect((await rows()).map((row) => row.status)).toEqual(Array(5).fill('PUBLISHED'));
    expect((await rows()).every((row) => row.publishedAt && !row.lockedUntil)).toBe(true);
  });

  it('BUS-I1: la topología declarada incluye la cola principal, las tres esperas y los fallidos', async () => {
    for (const queue of topology.queues) expect((await channel.checkQueue(queue.name)).queue).toBe(queue.name);
  });

  it('BUS-I1: un evento sin cola de destino se libera con espera y código UNROUTABLE; los demás se publican', async () => {
    await reset(); const ops = make();
    await ops.ingest(event()); await ops.ingest(event('otro.sin_cola'));
    expect(await ops.publishOutbox(farFuture())).toMatchObject({ claimed: 2, published: 1, pending: 1, brokerAvailable: true });
    const stored = await rows();
    expect(stored[1]).toMatchObject({ status: 'PENDING', lastError: 'UNROUTABLE', lockedUntil: null }); expect(stored[1].availableAt.getTime()).toBeGreaterThan(Date.now());
    await prisma.outboxEvent.deleteMany({ where: { ownerId: owner, status: 'PENDING' } });
  });

  it('BUS-I3 (ingreso): el mismo eventId dos veces deja una sola fila y un solo mensaje', async () => {
    await reset(); const ops = make(); const same = event();
    await ops.ingest(same); await ops.ingest(same);
    expect(await rows()).toHaveLength(1);
    await ops.publishOutbox(farFuture()); await ops.publishOutbox(farFuture());
    expect(await queueCount()).toBe(1);
  });

  it('BUS-I6: broker caído — el ingreso responde, las filas siguen PENDING con espera y al volver el broker se publican todas en orden', async () => {
    await reset(); const closed = make({}, new AmqpEventBus('amqp://127.0.0.1:1', topology, 500));
    const sent = [event(), event(), event()]; for (const item of sent) await closed.ingest(item);
    expect(await closed.publishOutbox(farFuture())).toEqual({ claimed: 3, published: 0, pending: 3, brokerAvailable: false });
    const waiting = await rows(); expect(waiting.map((row) => row.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect(waiting.every((row) => row.lastError === 'BROKER_UNAVAILABLE' && row.attempts === 1 && row.lockedUntil === null && row.availableAt.getTime() > Date.now())).toBe(true);
    await closed.ingest(event()); // el ingreso no depende del broker
    expect(await rows()).toHaveLength(4);
    // Con el broker de vuelta (reloj adelantado más allá de la espera) se publican las cuatro, en orden de seq.
    const back = make({}, undefined, () => new Date(Date.now() + 60_000));
    expect(await back.publishOutbox(farFuture())).toMatchObject({ claimed: 4, published: 4, pending: 0, brokerAvailable: true });
    const received = await drain();
    expect(received.slice(0, 3).map((message) => message.id)).toEqual(sent.map((item) => item.payload.eventId));
    expect(received).toHaveLength(4);
  });

  it('BUS-I6: una conexión que se corta a media publicación no pierde nada (las filas quedan PENDING y se republican)', async () => {
    await reset();
    const target = new URL(url); const sockets: Socket[] = [];
    const proxy: Server = createServer((client) => { const upstream = tcpConnect(Number(target.port || 5672), target.hostname); sockets.push(client, upstream); client.pipe(upstream); upstream.pipe(client); client.on('error', () => undefined); upstream.on('error', () => undefined); });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxied = new URL(url); proxied.hostname = '127.0.0.1'; proxied.port = String((proxy.address() as { port: number }).port);
    const real = new AmqpEventBus(proxied.toString(), topology, 3000);
    const cutting: EventBus = { ping: () => real.ping(), open: async (): Promise<BusSession> => { const session = await real.open(); return { close: () => session.close(), publish: async (batch: OutboxRow[]) => { for (const socket of sockets) socket.destroy(); return session.publish(batch); } }; } };
    try {
      const ops = make({}, cutting); const sent = event(); await ops.ingest(sent);
      const outcome = await ops.publishOutbox(farFuture());
      expect(outcome).toMatchObject({ published: 0, brokerAvailable: false });
      expect((await rows())[0]).toMatchObject({ status: 'PENDING', lockedUntil: null });
      const again = make({}, undefined, () => new Date(Date.now() + 60_000));
      expect(await again.publishOutbox(farFuture())).toMatchObject({ published: 1, pending: 0 });
      expect((await drain()).map((message) => message.id)).toEqual([sent.payload.eventId]);
    } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => proxy.close(() => resolve())); }
  }, 30_000);

  it('BUS-I7: dos publicadores concurrentes sobre la misma outbox publican cada evento una sola vez', async () => {
    await reset(); const a = make({ publishBatch: 10, publishMaxBatches: 10 }); const b = make({ publishBatch: 10, publishMaxBatches: 10 });
    const sent = Array.from({ length: 50 }, () => event()); for (const item of sent) await a.ingest(item);
    const [x, y] = await Promise.all([a.publishOutbox(farFuture()), b.publishOutbox(farFuture())]);
    expect(x.published + y.published).toBe(50);
    const received = await drain();
    expect(received).toHaveLength(50); expect(new Set(received.map((message) => message.id)).size).toBe(50);
    expect(new Set(received.map((message) => message.id))).toEqual(new Set(sent.map((item) => item.payload.eventId)));
  }, 60_000);

  it('BUS-I9: una fila reclamada por una instancia caída vuelve a estar disponible al vencer su arriendo', async () => {
    await reset(); const ops = make({ leaseMs: 60_000 }); await ops.ingest(event());
    expect(await outbox.claim(new Date(), 10, 60_000)).toHaveLength(1); // la instancia "muere" sin publicar ni liberar
    expect(await ops.publishOutbox(farFuture())).toMatchObject({ claimed: 0, published: 0, pending: 1 });
    const later = make({}, undefined, () => new Date(Date.now() + 61_000));
    expect(await later.publishOutbox(farFuture())).toMatchObject({ claimed: 1, published: 1, pending: 0 });
    expect(await queueCount()).toBe(1);
  });

  it('BUS-I10: las filas publicadas más viejas que la retención se limpian y las recientes se conservan', async () => {
    await reset(); const ops = make({ retentionDays: 7 }); await ops.ingest(event()); await ops.publishOutbox(farFuture());
    await ops.publishOutbox(farFuture());
    expect(await rows()).toHaveLength(1);
    const future = make({ retentionDays: 7 }, undefined, () => new Date(Date.now() + 8 * 86_400_000));
    await future.publishOutbox(farFuture());
    expect(await rows()).toHaveLength(0);
  });

  it('BUS-I11: sin carrera — una corrida sin filas pendientes no abre conexión al broker', async () => {
    await reset(); let opened = 0; const real = new AmqpEventBus(url, topology, 3000);
    const counting: EventBus = { ping: () => real.ping(), open: async () => { opened += 1; return real.open(); } };
    expect(await make({}, counting).publishOutbox(farFuture())).toMatchObject({ claimed: 0, brokerAvailable: true });
    expect(opened).toBe(0); await sleep(0);
  });
});
