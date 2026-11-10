/* global fetch, Response, RequestInit */
import { describe, expect, it, jest } from '@jest/globals';
import { EsbEventClient, esbEventClientFromEnv, warnIfEventBusBypassed } from '../src/esb-event-client';

describe('warnIfEventBusBypassed (condición de ADR-F12b2-01)', () => {
  it('en producción sin ESB_URL avisa una vez, con el servicio y sin valores de configuración', () => {
    const lines: string[] = [];
    const message = warnIfEventBusBypassed({ NODE_ENV: 'production', INTERNAL_API_KEY: 'secreto-que-no-debe-salir', WEBHOOKS_GRPC_URL: 'host:443' }, 'inventory-service', (line) => lines.push(line));
    expect(message).toContain('inventory-service: ESB_URL is not set in production');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', service: 'inventory-service', dependency: 'event-bus' });
    expect(lines[0]).not.toMatch(/secreto|host:443/);
  });
  it.each([
    ['con ESB_URL en producción', { NODE_ENV: 'production', ESB_URL: 'https://esb.test' }],
    ['en desarrollo sin ESB_URL', { NODE_ENV: 'development' }],
    ['en pruebas sin ESB_URL', { NODE_ENV: 'test' }],
    ['sin NODE_ENV', {}]
  ])('no avisa %s', (_name, env) => {
    const lines: string[] = [];
    expect(warnIfEventBusBypassed(env, 'reservation-service', (line) => lines.push(line))).toBeUndefined();
    expect(lines).toEqual([]);
  });
});

const KEY = 'k'.repeat(32);
const input = { ownerId: 'owner-1', payload: { eventId: '00000000-0000-4000-8000-000000000001', eventType: 'hold.expired', correlationId: 'corr-9', data: { holdId: 'h' } } };
type Call = { url: string; init: RequestInit };
const fake = (respond: () => Response | Promise<Response>, calls: Call[] = []): typeof fetch => (async (url: string, init: RequestInit) => { calls.push({ url, init }); return respond(); }) as unknown as typeof fetch;
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const client = (fetchImpl: typeof fetch, extra: object = {}) => new EsbEventClient({ baseUrl: 'http://127.0.0.1:3100/', internalApiKey: KEY, correlationId: 'inventory-service', fetchImpl, ...extra });

describe('EsbEventClient (F12b-2)', () => {
  it('envía el mismo mensaje PublishEvent al ESB con llave, correlación, dueño y rol system', async () => {
    const calls: Call[] = [];
    const result = await client(fake(() => json(200, { ok: true, result: { eventId: 'e-1' }, correlationId: 'corr-9' }), calls)).publish(input);
    expect(result).toEqual({ eventId: 'e-1' });
    expect(calls[0].url).toBe('http://127.0.0.1:3100/internal/v1/operations/clientes.publicar-evento');
    expect(calls[0].init.headers).toMatchObject({ 'x-internal-key': KEY, 'x-correlation-id': 'corr-9', 'x-owner-id': 'owner-1', 'x-role': 'system', 'x-deadline-ms': '5000' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ input });
  });

  it('usa la correlación del servicio cuando el evento no trae una', async () => {
    const calls: Call[] = [];
    await client(fake(() => json(200, { ok: true, result: {} }), calls)).publish({ ownerId: 'o', payload: { eventType: 'hold.expired' } });
    expect((calls[0].init.headers as Record<string, string>)['x-correlation-id']).toBe('inventory-service');
  });

  it.each([
    ['conexión rechazada', () => { throw new TypeError('fetch failed ECONNREFUSED 127.0.0.1:3100'); }, 14],
    ['ESB con 503', () => json(503, { ok: false, error: { source: 'service', grpcCode: 14, catalogCode: null } }), 14],
    ['ESB con 504', () => json(504, { ok: false, error: { source: 'esb', grpcCode: 4, catalogCode: null } }), 4],
    ['llave rechazada (error del ESB)', () => json(401, { ok: false, error: { source: 'esb', grpcCode: 16, catalogCode: null } }), 13],
    ['respuesta que no es JSON', () => new Response('<html>', { status: 502 }), 13]
  ])('traduce %s a un error con code %i y sin detalles internos', async (_name, respond, code) => {
    const rejection = await client(fake(respond as () => Response)).publish(input).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code, message: 'event publish to ESB failed' });
    expect(JSON.stringify(rejection)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|k{8}/);
  });

  it('un rechazo de dominio conserva el código gRPC y el del catálogo', async () => {
    const rejection = await client(fake(() => json(422, { ok: false, error: { source: 'service', grpcCode: 3, catalogCode: 'VALIDATION_FAILED' } }))).publish(input).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });

  it('vence el plazo con DEADLINE_EXCEEDED (4)', async () => {
    jest.useFakeTimers();
    try {
      const never = (async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => { init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); })) as unknown as typeof fetch;
      const pending = client(never, { timeoutMs: 1_000 }).publish(input).catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(1_001);
      expect(await pending).toMatchObject({ code: 4 });
    } finally { jest.useRealTimers(); }
  });

  it('exige un origen sin ruta y falla rápido si falta ESB_URL', () => {
    expect(() => new EsbEventClient({ baseUrl: 'http://esb.test/ruta', internalApiKey: KEY, correlationId: 'c' })).toThrow('ESB_URL must be an origin without path');
    expect(() => esbEventClientFromEnv({}, KEY, 'c')).toThrow('ESB_URL is required');
    expect(() => esbEventClientFromEnv({ ESB_URL: 'http://esb.test', ESB_EVENT_TIMEOUT_MS: 'x' }, KEY, 'c')).toThrow('ESB_EVENT_TIMEOUT_MS');
    expect(esbEventClientFromEnv({ ESB_URL: 'https://esb.test/' }, KEY, 'c')).toBeInstanceOf(EsbEventClient);
  });
});
