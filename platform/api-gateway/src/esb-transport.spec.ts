/* global __dirname */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { status } from '@grpc/grpc-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { OPERATIONS } from '../../../microservices/esb-service/src/domain/catalog';
import { loadConfig, type GatewayConfig } from './config';
import { asProblem } from './web-errors';
import { callEsbOperation, deadlineFor, EsbCallError } from './esb-client';
import { ESB_OPERATIONS } from './esb-operations';
import { callGatewayGrpc, fetchSeatMap } from './grpc-clients';
import { createGatewayApp } from './app';
import { GatewayScheduler } from './scheduler';

// Detectores de la regla "con GATEWAY_TRANSPORT=esb no se crea ningún cliente gRPC a los microservicios".
const mockDirectLoads: string[] = [];
const mockGrpcClients: string[] = [];
jest.mock('./direct-grpc', () => { mockDirectLoads.push('direct-grpc'); return jest.requireActual('./direct-grpc'); });
jest.mock('./direct-health', () => { mockDirectLoads.push('direct-health'); return jest.requireActual('./direct-health'); });
jest.mock('@flight-platform/shared', () => {
  const actual = jest.requireActual('@flight-platform/shared') as Record<string, unknown>;
  return { ...actual, createGrpcClient: (...args: unknown[]) => { mockGrpcClients.push('createGrpcClient'); return (actual.createGrpcClient as (...a: unknown[]) => unknown)(...args); } };
});

jest.setTimeout(60_000);
const KEY = 'k'.repeat(32);

interface Seen { url: string; headers: IncomingMessage['headers']; body: { input?: unknown } }
let esb: Server; let esbUrl = ''; const seen: Seen[] = [];
let reply: (operation: string, seenRequest: Seen) => { status: number; body: unknown } | 'hang' = () => ({ status: 200, body: { ok: true, result: {} } });
const pending = new Set<() => void>();

beforeAll(async () => {
  esb = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const entry: Seen = { url: req.url ?? '', headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') };
      seen.push(entry);
      const outcome = reply(entry.url.replace('/internal/v1/operations/', ''), entry);
      if (outcome === 'hang') { pending.add(() => res.destroy()); return; }
      res.writeHead(outcome.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(outcome.body));
    });
  });
  await new Promise<void>((resolve) => esb.listen(0, '127.0.0.1', resolve));
  esbUrl = `http://127.0.0.1:${(esb.address() as { port: number }).port}`;
});
afterAll(async () => { for (const drop of pending) drop(); await new Promise<void>((resolve) => esb.close(() => resolve())); });
afterEach(() => { reply = () => ({ status: 200, body: { ok: true, result: {} } }); seen.length = 0; });

const dir = mkdtempSync(join(tmpdir(), 'gateway-esb-'));
const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
const publicKey = join(dir, 'public.pem'); writeFileSync(publicKey, pair.publicKey);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const env = (more: Record<string, string> = {}) => ({ NODE_ENV: 'test', INTERNAL_API_KEY: KEY, VALIDATE_RESPONSES: 'false', SCHEDULER_ENABLED: 'false', PUBLIC_BASE_URL: 'http://gateway.test', DEV_AUTH_PRIVATE_KEY: pair.privateKey, HEALTH_CACHE_MS: '0', JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: publicKey }]), ...more });
const config = (more: Record<string, string> = {}): GatewayConfig => loadConfig({ ...env(), ESB_URL: esbUrl, GATEWAY_TRANSPORT: 'esb', ...more });
const serviceError = (grpcCode: number, catalogCode: string | null = null, step?: string) => ({ ok: false, error: { source: 'service', grpcCode, grpcStatus: status[grpcCode], catalogCode, ...(step ? { step } : {}) } });

describe('F12b-1 transporte del Gateway hacia el ESB', () => {
  it('ESBT-01: el transporte por defecto es esb y ESB_URL se normaliza y valida', () => {
    // El valor por defecto se comprueba sin el entorno del proceso (las corridas con GATEWAY_TRANSPORT=grpc lo fijan).
    const saved = { transport: process.env.GATEWAY_TRANSPORT, url: process.env.ESB_URL };
    delete process.env.GATEWAY_TRANSPORT; delete process.env.ESB_URL;
    try {
      expect(loadConfig(env())).toMatchObject({ transport: 'esb', esbUrl: 'http://localhost:3100', esbUrlConfigured: false });
      expect(loadConfig({ ...env(), ESB_URL: 'https://esb.example.test/' })).toMatchObject({ transport: 'esb', esbUrl: 'https://esb.example.test', esbUrlConfigured: true });
      expect(loadConfig({ ...env(), GATEWAY_TRANSPORT: 'grpc' }).transport).toBe('grpc');
      expect(() => loadConfig({ ...env(), GATEWAY_TRANSPORT: 'http' })).toThrow('GATEWAY_TRANSPORT must be esb or grpc');
      expect(() => loadConfig({ ...env(), ESB_URL: 'https://esb.example.test/ruta' })).toThrow('ESB_URL must be an origin without path');
    } finally {
      if (saved.transport !== undefined) process.env.GATEWAY_TRANSPORT = saved.transport;
      if (saved.url !== undefined) process.env.ESB_URL = saved.url;
    }
  });

  it('ESBT-02: una llamada va como operación con nombre, con llave, correlación, identidad y plazo; el resultado es el del servicio', async () => {
    reply = () => ({ status: 200, body: { ok: true, result: { totalOffers: 1 } } });
    const result = await callGatewayGrpc(config(), 'pricing', 'searchOffers', { legs: [] }, 'corr-1', { ownerId: 'owner-1', role: 'customer', scopes: new Set() });
    expect(result).toEqual({ totalOffers: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/internal/v1/operations/vuelos.buscar-ofertas');
    expect(seen[0].body).toEqual({ input: { legs: [] } });
    expect(seen[0].headers).toMatchObject({ 'x-internal-key': KEY, 'x-correlation-id': 'corr-1', 'x-owner-id': 'owner-1', 'x-role': 'customer', 'x-deadline-ms': '5000' });
  });

  it('ESBT-03: las cuatro operaciones orquestadas piden 30 s (GATEWAY_ORCHESTRATION_DEADLINE_MS) y el resto 5 s', () => {
    for (const method of ['createReservation', 'addBaggage', 'confirmDateChange', 'cancelReservation']) expect(deadlineFor('reservation', method, {})).toBe(30_000);
    expect(deadlineFor('reservation', 'getReservation', {})).toBe(5_000);
    expect(deadlineFor('pricing', 'createReservation', {})).toBe(5_000);
    expect(deadlineFor('reservation', 'createReservation', { GATEWAY_ORCHESTRATION_DEADLINE_MS: '12000' })).toBe(12_000);
  });

  it('ESBT-04: un error de dominio del servicio llega con su código gRPC y del catálogo, y se traduce igual que antes', async () => {
    reply = () => ({ status: 422, body: serviceError(9, 'SEAT_TAKEN') });
    const error = await callGatewayGrpc(config(), 'ancillaries', 'changeSeats', {}, 'c').catch((thrown: unknown) => thrown) as EsbCallError;
    expect(error).toMatchObject({ code: 9, details: 'SEAT_TAKEN' });
    expect(asProblem(error)).toMatchObject({ status: 409, code: 'SEAT_TAKEN' });
  });

  it('ESBT-05: servicio caído tras el ESB, ESB caído y plazo vencido son 503 (los dos últimos como transitorios)', async () => {
    reply = () => ({ status: 503, body: serviceError(14) });
    expect(asProblem(await callGatewayGrpc(config(), 'pricing', 'searchOffers', {}, 'c').catch((e: unknown) => e))).toMatchObject({ status: 503 });
    const dead = config({ ESB_URL: 'http://127.0.0.1:1' });
    const refused = await callGatewayGrpc(dead, 'pricing', 'searchOffers', {}, 'c').catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: status.UNAVAILABLE }); expect(asProblem(refused)).toMatchObject({ status: 503 });
    reply = () => 'hang';
    const slow = await callEsbOperation(config(), { operation: 'vuelos.buscar-ofertas', input: {}, correlationId: 'c', deadlineMs: 80, abortMarginMs: 40 }).catch((e: unknown) => e);
    expect(slow).toMatchObject({ code: status.DEADLINE_EXCEEDED }); expect(asProblem(slow)).toMatchObject({ status: 503 });
  });

  it('ESBT-06: un error del propio ESB (llave, operación, sobre) no se traduce a 401/404/400 para el cliente: es 500 genérico', async () => {
    for (const [code, http] of [[16, 401], [12, 404], [3, 400], [13, 500]] as const) {
      reply = () => ({ status: http, body: { ok: false, error: { source: 'esb', grpcCode: code, grpcStatus: status[code], catalogCode: null } } });
      const error = await callGatewayGrpc(config(), 'pricing', 'searchOffers', {}, 'c').catch((e: unknown) => e);
      // Igual que una falla INTERNAL de un servicio hoy (nunca 401/404 para el cliente por culpa del ESB).
      expect(error).toMatchObject({ code: 13 }); expect(asProblem(error)).toEqual(asProblem({ code: 13 }));
      expect([401, 404]).not.toContain(asProblem(error).status);
    }
    reply = () => ({ status: 502, body: { not: 'an envelope' } });
    expect(await callGatewayGrpc(config(), 'pricing', 'searchOffers', {}, 'c').catch((e: unknown) => e)).toMatchObject({ code: 13 });
  });

  it('ESBT-07: mapa de asientos: una operación; segmento inexistente (paso 1) es undefined; NOT_FOUND del paso 2 se relanza', async () => {
    reply = () => ({ status: 200, body: { ok: true, result: { segmentId: 's', cabins: [] } } });
    expect(await fetchSeatMap(config(), 'o', 's', 'c')).toEqual({ segmentId: 's', cabins: [] });
    expect(seen.map((s) => s.url)).toEqual(['/internal/v1/operations/vuelos.mapa-asientos']);
    expect(seen[0].body).toEqual({ input: { offerId: 'o', segmentId: 's' } });
    reply = () => ({ status: 404, body: serviceError(5, 'NOT_FOUND', 'resolveSegment') });
    expect(await fetchSeatMap(config(), 'o', 's', 'c')).toBeUndefined();
    reply = () => ({ status: 404, body: serviceError(5, 'NOT_FOUND', 'getSeatMapForOffer') });
    expect(await fetchSeatMap(config(), 'o', 's', 'c').catch((e: unknown) => e)).toMatchObject({ code: 5 });
  });

  it('ESBT-08: la tabla de operaciones del Gateway coincide con el catálogo del ESB (sin desfase)', () => {
    const catalog = new Map(OPERATIONS.flatMap((operation) => operation.kind === 'rpc' ? [[`${operation.service}.${operation.method}`, operation.name] as const] : []));
    expect(new Map(Object.entries(ESB_OPERATIONS))).toEqual(catalog);
    const names = new Set(OPERATIONS.map((operation) => operation.name));
    expect(names.has('vuelos.mapa-asientos')).toBe(true); expect(names.has('sistema.salud')).toBe(true);
  });

  it('ESBT-09: un método sin operación en el catálogo falla sin llamar al ESB', async () => {
    await expect(callGatewayGrpc(config(), 'pricing', 'noExiste', {}, 'c')).rejects.toThrow('Unknown ESB operation');
    expect(seen).toHaveLength(0);
  });
});

describe('F12b-1 el Gateway por HTTP con el ESB', () => {
  it('ESBT-10: con el ESB caído una ruta pública responde 503 con Retry-After (v1 y v2)', async () => {
    const app = await createGatewayApp(config({ ESB_URL: 'http://127.0.0.1:1' }));
    try {
      const v2 = await request(app.getHttpServer()).get('/api/v2/vuelos/flights/FP1234/status?date=2026-12-01');
      expect(v2.status).toBe(503); expect(v2.headers['retry-after']).toBe('5');
      const v1 = await request(app.getHttpServer()).get('/flights/v1/offers/6f9619ff-8b86-4011-b42d-00c04fc964ff/seatmap?segmentId=6f9619ff-8b86-4011-b42d-00c04fc964ff');
      expect(v1.status).toBe(503); expect(v1.headers['retry-after']).toBe('5');
    } finally { await app.close(); }
  });

  it('ESBT-11: el estado público de un vuelo va por la operación del ESB y conserva su forma', async () => {
    reply = () => ({ status: 200, body: { ok: true, result: { flightNumber: 'FP1234', departure: { scheduledAt: '2026-12-01T10:00:00Z', estimatedAt: '2026-12-01T10:30:00Z' } } } });
    const app = await createGatewayApp(config());
    try {
      const res = await request(app.getHttpServer()).get('/api/v2/vuelos/flights/FP1234/status?date=2026-12-01');
      expect(res.status).toBe(200); expect(res.body).toMatchObject({ flightNumber: 'FP1234', delayMinutes: 30 });
      expect(seen[0].url).toBe('/internal/v1/operations/vuelos.estado-vuelo');
    } finally { await app.close(); }
  });

  it('ESBT-12: el health v2 sale del ESB (sistema.salud), conserva el formato y con el ESB caído es 503 con los siete DOWN', async () => {
    const dependencias = ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'].map((name) => ({ nombre: `${name}-service`, status: 'UP', latencia_ms: 2 }));
    reply = () => ({ status: 200, body: { ok: true, result: { status: 'HEALTHY', dependencias } } });
    const app = await createGatewayApp(config());
    try {
      const ok = await request(app.getHttpServer()).get('/api/v2/vuelos/health');
      expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ status: 'HEALTHY', vertical: 'VUELOS' }); expect(ok.body.dependencias).toHaveLength(7);
      expect(seen[0].url).toBe('/internal/v1/operations/sistema.salud');
    } finally { await app.close(); }
    const down = await createGatewayApp(config({ ESB_URL: 'http://127.0.0.1:1' }));
    try {
      const res = await request(down.getHttpServer()).get('/api/v2/vuelos/health');
      expect(res.status).toBe(503); expect(res.body.status).toBe('DOWN'); expect(res.body.dependencias).toHaveLength(7);
      expect(res.body.dependencias.every((d: { status: string }) => d.status === 'DOWN')).toBe(true);
    } finally { await down.close(); }
  });

  it('ESBT-13: las tareas del scheduler van por el ESB con rol system', async () => {
    const store = { acquire: async () => true, release: async () => undefined, purgeIdempotency: async () => undefined };
    const scheduler = new GatewayScheduler(config({ SCHEDULER_ENABLED: 'true' }), store as never);
    await scheduler.run('expire-holds'); await scheduler.run('resume-pending'); await scheduler.run('dispatch-pending'); await scheduler.run('recover-check-ins');
    expect(seen.map((s) => s.url.replace('/internal/v1/operations/', ''))).toEqual(['sistema.expirar-holds', 'sistema.reanudar-pendientes', 'sistema.despachar-webhooks', 'sistema.recuperar-check-ins']);
    expect(seen.every((s) => s.headers['x-role'] === 'system' && s.headers['x-owner-id'] === 'gateway-scheduler')).toBe(true);
  });
});

describe('F12b-1 regla: con GATEWAY_TRANSPORT=esb el Gateway no crea clientes gRPC a los microservicios', () => {
  const productionFiles = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });

  it('ESBT-14: ningún flujo (v1, v2, health, scheduler, mapa de asientos) carga el transporte directo ni llama a createGrpcClient', async () => {
    mockDirectLoads.length = 0; mockGrpcClients.length = 0;
    reply = () => ({ status: 200, body: { ok: true, result: { status: 'HEALTHY', dependencias: [], departure: {}, cabins: [] } } });
    const app = await createGatewayApp(config());
    try {
      const server = app.getHttpServer();
      await request(server).get('/api/v2/vuelos/health');
      await request(server).get('/api/v2/vuelos/flights/FP1234/status?date=2026-12-01');
      await request(server).get('/api/v2/vuelos/offers/6f9619ff-8b86-4011-b42d-00c04fc964ff/seatmap?segmentId=6f9619ff-8b86-4011-b42d-00c04fc964ff');
      await request(server).get('/flights/v1/offers/6f9619ff-8b86-4011-b42d-00c04fc964ff/seatmap?segmentId=6f9619ff-8b86-4011-b42d-00c04fc964ff');
      // El lock del scheduler va a Prisma en la app real; aquí se usa un almacén falso para no depender de DATABASE_URL (el CI no la tiene).
      const store = { acquire: async () => true, release: async () => undefined, purgeIdempotency: async () => undefined };
      await new GatewayScheduler(config({ SCHEDULER_ENABLED: 'true' }), store as never).runAll();
      await callGatewayGrpc(config(), 'inventory', 'expireHolds', {}, 'c');
    } finally { await app.close(); }
    expect(seen.length).toBeGreaterThan(5);
    expect(mockDirectLoads).toEqual([]);
    expect(mockGrpcClients).toEqual([]);
  });

  it('ESBT-15: el detector es válido: con transport=grpc sí se carga el transporte directo y se crea el cliente', async () => {
    mockDirectLoads.length = 0; mockGrpcClients.length = 0;
    const error = await callGatewayGrpc(loadConfig({ ...env(), GATEWAY_TRANSPORT: 'grpc', GRPC_TLS: 'false' }), 'pricing', 'searchOffers', {}, 'c').catch((e: unknown) => e);
    expect(mockDirectLoads).toContain('direct-grpc'); expect(mockGrpcClients).toContain('createGrpcClient');
    expect(error).toBeDefined();
  });

  it('ESBT-16: en el código de producción solo direct-grpc.ts crea clientes gRPC de microservicios y solo direct-health.ts los sondea', () => {
    const files = productionFiles(__dirname);
    const using = (pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map((file) => file.slice(__dirname.length + 1).replace(/\\/g, '/')).sort();
    expect(using(/\bcreateGrpcClient\b/)).toEqual(['direct-grpc.ts']);
    // Booking (stock; integración externa que pasa al ESB en F12b-3) y el servidor falso de pruebas son los únicos otros usos de grpc-js.
    expect(using(/\bloadPackageDefinition\b/)).toEqual(['direct-health.ts', 'v2/stock/stock-sync.ts']);
    expect(using(/makeGenericClientConstructor/)).toEqual(['test-grpc.ts']);
  });

  it('ESBT-17: con transport=esb el único cliente gRPC del gateway es el del stock externo de Booking (excepción aprobada hasta F12b-3)', () => {
    const files = productionFiles(__dirname);
    const relative = (file: string) => file.slice(__dirname.length + 1).replace(/\\/g, '/');
    const constructsClient = files.filter((file) => /\b(loadPackageDefinition|makeGenericClientConstructor|createGrpcClient)\b/.test(readFileSync(file, 'utf8'))).map(relative).sort();
    // Se descartan el transporte directo (se carga solo con transport=grpc, ESBT-14), el sondeo directo y el servidor falso de pruebas.
    const lazyDirect = new Set(['direct-grpc.ts', 'direct-health.ts', 'test-grpc.ts']);
    expect(constructsClient.filter((file) => !lazyDirect.has(file))).toEqual(['v2/stock/stock-sync.ts']);
    // Y ese cliente habla con Booking (servicio de stock del contrato), no con un microservicio de la plataforma.
    const stock = readFileSync(join(__dirname, 'v2/stock/stock-sync.ts'), 'utf8');
    expect(stock).toMatch(/InventoryStockService/);
    expect(stock).toMatch(/contracts', 'proto', 'external', 'booking'/);
    expect(stock).not.toMatch(/\b(INVENTORY|PRICING|ANCILLARIES|RESERVATION|TICKETING|OPERATIONS|WEBHOOKS)_GRPC_URL|grpcUrls/); // la disponibilidad que lee para empujar sí viaja por callGatewayGrpc (⇒ ESB)
  });
});

describe('F12b-1 bloque D: fallas por HTTP, iguales a las del transporte gRPC', () => {
  const V2 = '/api/v2/vuelos/flights/FP1234/status?date=2026-12-01';
  const V1 = '/flights/v1/offers/6f9619ff-8b86-4011-b42d-00c04fc964ff/seatmap?segmentId=6f9619ff-8b86-4011-b42d-00c04fc964ff';
  const DEAD_GRPC = Object.fromEntries(['INVENTORY', 'PRICING', 'ANCILLARIES', 'RESERVATION', 'TICKETING', 'OPERATIONS', 'WEBHOOKS'].map((name) => [`${name}_GRPC_URL`, '127.0.0.1:1']));
  const shape = (res: { status: number; headers: Record<string, string>; body: { code?: string } }) => ({ status: res.status, retryAfter: res.headers['retry-after'], code: res.body.code });

  async function hit(cfg: GatewayConfig, path: string) {
    const app = await createGatewayApp(cfg);
    try { return shape(await request(app.getHttpServer()).get(path)); } finally { await app.close(); }
  }
  const both = async (cfg: GatewayConfig) => ({ v2: await hit(cfg, V2), v1: await hit(cfg, V1) });

  it('ESBT-18: ESB caído, servicio caído tras el ESB y plazo vencido responden 503 + Retry-After con el código del catálogo vigente, igual que grpc con el servicio caído', async () => {
    const baseline = await both(loadConfig({ ...env(), GATEWAY_TRANSPORT: 'grpc', ...DEAD_GRPC }));
    expect(baseline.v2).toEqual({ status: 503, retryAfter: '5', code: 'PROVIDER_UNAVAILABLE' });
    expect(baseline.v1).toMatchObject({ status: 503, retryAfter: '5' });

    // ESB caído
    expect(await both(config({ ESB_URL: 'http://127.0.0.1:1' }))).toEqual(baseline);
    // Servicio caído tras el ESB (el ESB responde 503 con UNAVAILABLE del servicio)
    reply = () => ({ status: 503, body: serviceError(14) });
    expect(await both(config())).toEqual(baseline);
    // Plazo vencido: el ESB no responde dentro del plazo de la operación (5 s) más el margen
    reply = () => 'hang';
    expect(await both(config())).toEqual(baseline);
    // Plazo vencido que informa el propio ESB (DEADLINE_EXCEEDED del servicio, HTTP 504)
    reply = () => ({ status: 504, body: serviceError(4) });
    expect(await both(config())).toEqual(baseline);
  });
});
