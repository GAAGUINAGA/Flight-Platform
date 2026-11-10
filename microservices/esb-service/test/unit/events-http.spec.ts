import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createEsbApp } from '../../src/app';
import type { EventOperations } from '../../src/application/event-ports';
import { loadConfig } from '../../src/config';
import { FakeInvoker, FakeProbe, KEY, MemoryLogger, testConfig } from './fakes';

const ID = '00000000-0000-4000-8000-000000000001';
const calls: Array<{ kind: string; input?: unknown }> = [];
const events: EventOperations = {
  ingest: async (input) => { calls.push({ kind: 'ingest', input }); return { eventId: ID }; },
  publishOutbox: async () => { calls.push({ kind: 'publish' }); return { claimed: 0, published: 0, pending: 0, brokerAvailable: true }; }
};
const logger = new MemoryLogger();
let app: INestApplication; let plain: INestApplication;
const post = (target: INestApplication, operation: string, body: object, headers: Record<string, string> = {}) => request(target.getHttpServer()).post(`/internal/v1/operations/${operation}`).set({ 'x-internal-key': KEY, 'x-correlation-id': 'corr-http', ...headers }).send(body);
const SECRET_BOOKING = { ownerId: 'owner-secreto', payload: { eventId: ID, eventType: 'booking.confirmed', data: { bookingId: 'b-1', pnr: 'PNRSECRETO' } } };

beforeAll(async () => {
  app = await createEsbApp(testConfig({ events: { ...testConfig().events, mode: 'outbox' } }), { invoker: new FakeInvoker(), logger, probe: new FakeProbe(), events, busHealth: async () => ({ broker: 'UP', outboxPendientes: 3 }) });
  plain = await createEsbApp(testConfig(), { invoker: new FakeInvoker(), logger: new MemoryLogger(), probe: new FakeProbe() });
});
afterAll(async () => { await app?.close(); await plain?.close(); });

describe('BUS-SEC: ingreso y publicación por HTTP', () => {
  it('BUS-SEC1: sin llave interna ambas operaciones responden 401 y no llegan al bus', async () => {
    calls.length = 0;
    for (const operation of ['clientes.publicar-evento', 'sistema.publicar-eventos']) {
      const response = await request(app.getHttpServer()).post(`/internal/v1/operations/${operation}`).set('x-role', 'system').send({ input: SECRET_BOOKING });
      expect(response.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('BUS-SEC1: con llave pero rol distinto de system responde 403 PERMISSION_DENIED', async () => {
    calls.length = 0;
    const response = await post(app, 'clientes.publicar-evento', { input: SECRET_BOOKING }, { 'x-role': 'customer' });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ ok: false, error: { source: 'service', grpcCode: 7, catalogCode: 'PERMISSION_DENIED' } });
    expect(calls).toHaveLength(0);
  });

  it('el ingreso responde con el mismo sobre que antes: {ok, result:{eventId}}', async () => {
    const response = await post(app, 'clientes.publicar-evento', { input: SECRET_BOOKING }, { 'x-role': 'system', 'x-owner-id': 'owner-secreto' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, result: { eventId: ID }, correlationId: 'corr-http' });
  });

  it('BUS-SEC2: un cuerpo mayor que ESB_MAX_BODY_BYTES se rechaza antes de llegar al bus', async () => {
    calls.length = 0;
    const response = await post(app, 'clientes.publicar-evento', { input: { ownerId: 'o', payload: { eventType: 'booking.confirmed', data: { blob: 'x'.repeat(10_000) } } } }, { 'x-role': 'system' });
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('BUS-SEC3: los logs de operación no contienen data, dueño ni PNR', async () => {
    await post(app, 'clientes.publicar-evento', { input: SECRET_BOOKING }, { 'x-role': 'system' });
    const text = JSON.stringify(logger.entries);
    expect(logger.entries.some((entry) => entry.operation === 'clientes.publicar-evento' && entry.outcome === 'ok')).toBe(true);
    for (const secret of ['PNRSECRETO', 'owner-secreto', 'b-1']) expect(text).not.toContain(secret);
  });

  it('sistema.publicar-eventos con rol system devuelve el informe', async () => {
    const response = await post(app, 'sistema.publicar-eventos', { input: {} }, { 'x-role': 'system' });
    expect(response.body).toEqual({ ok: true, result: { claimed: 0, published: 0, pending: 0, brokerAvailable: true }, correlationId: 'corr-http' });
  });
});

describe('BUS: salud', () => {
  it('/health/deps agrega el bloque bus sin cambiar las siete dependencias', async () => {
    const response = await request(app.getHttpServer()).get('/health/deps').set('x-internal-key', KEY);
    expect(response.status).toBe(200);
    expect(response.body.dependencias).toHaveLength(7); expect(response.body.expected).toBe(7);
    expect(response.body.bus).toEqual({ broker: 'UP', outboxPendientes: 3 });
  });

  it('sin bus configurado (modo grpc) no hay bloque bus', async () => {
    const response = await request(plain.getHttpServer()).get('/health/deps').set('x-internal-key', KEY);
    expect(response.body).not.toHaveProperty('bus');
  });
});

describe('BUS: configuración', () => {
  const base = { INTERNAL_API_KEY: 'k' };
  it('por defecto el modo es outbox, con los límites y TTL del diseño', () => {
    expect(loadConfig(base).events).toEqual({
      mode: 'outbox', databaseUrl: undefined, rabbitmqUrl: undefined, retryTtlsMs: [30_000, 120_000, 600_000], connectTimeoutMs: 3_000,
      limits: { maxEventBytes: 65_536, publishBatch: 100, publishMaxBatches: 5, leaseMs: 60_000, retentionDays: 7 }
    });
  });
  it('lee modo, URLs, TTL y límites del entorno; nada se fija en el código', () => {
    const events = loadConfig({ ...base, ESB_EVENTS_MODE: 'grpc', RABBITMQ_URL: 'amqp://x', DATABASE_URL: 'postgresql://y', EVENTS_RETRY_TTLS_MS: '100, 200', EVENTS_PUBLISH_BATCH: '7', ESB_OUTBOX_RETENTION_DAYS: '1' }).events;
    expect(events).toMatchObject({ mode: 'grpc', rabbitmqUrl: 'amqp://x', databaseUrl: 'postgresql://y', retryTtlsMs: [100, 200], limits: { publishBatch: 7, retentionDays: 1 } });
  });
  it('rechaza valores inválidos', () => {
    expect(() => loadConfig({ ...base, ESB_EVENTS_MODE: 'otro' })).toThrow('ESB_EVENTS_MODE must be outbox or grpc');
    expect(() => loadConfig({ ...base, EVENTS_RETRY_TTLS_MS: '10,abc' })).toThrow('EVENTS_RETRY_TTLS_MS');
    expect(() => loadConfig({ ...base, EVENTS_PUBLISH_BATCH: '0' })).toThrow('EVENTS_PUBLISH_BATCH');
  });
  it('BUS-SEC4: en producción RABBITMQ_URL debe usar amqps, salvo el perfil de integración local', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', RABBITMQ_URL: 'amqp://broker' })).toThrow('RABBITMQ_URL must use amqps in production');
    expect(loadConfig({ ...base, NODE_ENV: 'production', RABBITMQ_URL: 'amqps://broker' }).events.rabbitmqUrl).toBe('amqps://broker');
    expect(loadConfig({ ...base, RABBITMQ_URL: 'amqp://127.0.0.1' }).events.rabbitmqUrl).toBe('amqp://127.0.0.1');
  });
  it('el mensaje de error de configuración nunca incluye la URL del broker', () => {
    try { loadConfig({ ...base, NODE_ENV: 'production', RABBITMQ_URL: 'amqp://usuario:clave@broker' }); } catch (error) { expect(String(error)).not.toContain('clave'); }
  });
  it('en modo outbox sin conexiones el arranque real falla rápido', async () => {
    await expect(createEsbApp(testConfig({ events: { ...testConfig().events, mode: 'outbox' } }), { invoker: new FakeInvoker() })).rejects.toThrow('DATABASE_URL and RABBITMQ_URL are required');
  });
});
