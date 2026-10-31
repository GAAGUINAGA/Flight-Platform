import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Server, ServerCredentials, status } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { createDevToken } from '../../../infra/scripts/dev-token';
import { loadConfig } from './config';
import { PUBLIC_PROBLEM_CODES } from './errors';
import { configuredGrpcTargets } from './grpc-clients';
import { createGatewayApp } from './app';
import { RateLimitGuard } from './security';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const decode = (value: Buffer) => JSON.parse(value.toString('utf8'));
const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

// Cada prueba levanta una app Nest y/o un servidor gRPC; no debe depender del plazo por defecto de Jest (5 s).
jest.setTimeout(60_000);

describe('F4 Gateway base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-jwt-'));
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  const pub = join(dir, 'public.pem'); writeFileSync(pub, keys.publicKey);
  const env = { NODE_ENV: 'test', INTERNAL_API_KEY: 'x'.repeat(32), JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: pub }]), VALIDATE_RESPONSES: 'false' };
  const grpc = new Server(); let grpcAddress = ''; let grpcFailure: number | undefined; let grpcFailureDetails: string | undefined; let received: Record<string, string[]> | undefined;
  const token = (sub = 'owner-1', role = 'customer', scope = 'flights:read', now?: number, issuer?: string) => `Bearer ${createDevToken(keys.privateKey, { sub, app_role: role, scope }, now, { iss: issuer })}`;
  const app = async (more: Record<string, string> = {}) => createGatewayApp(loadConfig({ ...env, ...more }));
  const key = (offset = 0) => `00000000-0000-4000-8000-${(Date.now() + offset).toString().padStart(12, '0').slice(-12)}`;

  beforeAll(async () => {
    grpc.addService({ Execute: { path: '/flight.gateway.test.v1.GatewayTest/Execute', requestStream: false, responseStream: false, requestSerialize: encode, requestDeserialize: decode, responseSerialize: encode, responseDeserialize: decode } }, {
      Execute: (_call: unknown, callback: (error: Error | null, value?: unknown) => void) => {
        const call = _call as { metadata: { getMap(): Record<string, string[]> } }; received = call.metadata.getMap();
        if (grpcFailure !== undefined) { callback(Object.assign(new Error('dependency unavailable'), { code: grpcFailure, details: grpcFailureDetails })); return; }
        callback(null, { ok: true });
      }
    });
    await new Promise<void>((resolve, reject) => grpc.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : (grpcAddress = `127.0.0.1:${port}`, resolve())));
    process.env.GATEWAY_TEST_GRPC_URL = grpcAddress;
  });
  afterAll(async () => { await new Promise<void>((resolve) => grpc.tryShutdown(resolve)); delete process.env.GATEWAY_TEST_GRPC_URL; rmSync(dir, { recursive: true, force: true }); });

  it('GW-SEC-01: sin token ⇒ 401', async () => { const instance = await app(); try { expect((await request(instance.getHttpServer()).post('/flights/v1/__test/secured').send({})).status).toBe(401); } finally { await instance.close(); } });
  it('GW-SEC-01: firma inválida ⇒ 401', async () => { const instance = await app(); try { const parts = token().slice(7).split('.'); parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`; expect((await request(instance.getHttpServer()).post('/flights/v1/__test/secured').set('Authorization', `Bearer ${parts.join('.')}`).send({})).status).toBe(401); } finally { await instance.close(); } });
  it('GW-SEC-01: token expirado ⇒ 401', async () => { const instance = await app(); try { expect((await request(instance.getHttpServer()).post('/flights/v1/__test/secured').set('Authorization', token('expired', 'customer', 'flights:read', Math.floor(Date.now() / 1000) - 7200)).send({})).status).toBe(401); } finally { await instance.close(); } });
  it('GW-SEC-01: alg none ⇒ 401', async () => { const instance = await app(); const none = `${base64({ alg: 'none', typ: 'JWT' })}.${base64({ sub: 'none', app_role: 'customer', scope: 'flights:read', iss: 'flight-platform-dev', aud: 'flight-platform', exp: Math.floor(Date.now() / 1000) + 3600 })}.`; try { expect((await request(instance.getHttpServer()).post('/flights/v1/__test/secured').set('Authorization', `Bearer ${none}`).send({})).status).toBe(401); } finally { await instance.close(); } });
  it('GW-SEC-01: emisor no listado ⇒ 401', async () => { const instance = await app(); try { expect((await request(instance.getHttpServer()).post('/flights/v1/__test/secured').set('Authorization', token('other-issuer', 'customer', 'flights:read', undefined, 'unlisted')).send({})).status).toBe(401); } finally { await instance.close(); } });
  it('GW-SEC-01: producción rechaza un emisor publicKeyFile al arrancar', () => { expect(() => loadConfig({ ...env, NODE_ENV: 'production' })).toThrow('Development JWT issuers'); });

  it('GW-04/GW-09 traverse guards, idempotency and a real gRPC server, including metadata propagation', async () => {
    const instance = await app(); const server = instance.getHttpServer(); const requestKey = key();
    try { const first = await request(server).post('/flights/v1/__test/secured').set('Authorization', token()).set('Idempotency-Key', requestKey).set('X-Correlation-Id', 'corr-test').send({ a: 1 }); expect(first.status).toBe(201); expect(received).toMatchObject({ 'x-correlation-id': 'corr-test', 'x-internal-key': 'x'.repeat(32), 'x-owner-id': 'owner-1', 'x-role': 'customer' }); expect((await request(server).post('/flights/v1/__test/secured').set('Authorization', token()).set('Idempotency-Key', requestKey).send({ a: 1 })).status).toBe(201); expect((await request(server).post('/flights/v1/__test/secured').set('Authorization', token()).set('Idempotency-Key', requestKey).send({ a: 2 })).status).toBe(422); } finally { await instance.close(); }
  });

  it('GW-SEC-02/GW-05 deny scopes and limit authenticated callers by sub', async () => {
    const instance = await app({ RATE_LIMIT_AUTH_PER_MIN: '1' }); const server = instance.getHttpServer();
    try { expect((await request(server).post('/flights/v1/__test/secured').set('Authorization', token('scope', 'customer', 'flights:hold')).set('Idempotency-Key', key()).send({})).status).toBe(403); expect((await request(server).post('/flights/v1/__test/admin').set('Authorization', token('role')).send({})).status).toBe(403); expect((await request(server).post('/flights/v1/__test/secured').set('Authorization', token('limited')).set('Idempotency-Key', key()).send({})).status).toBe(201); const limited = await request(server).post('/flights/v1/__test/secured').set('Authorization', token('limited')).set('Idempotency-Key', key(1)).send({}); expect(limited.status).toBe(429); expect(limited.body.code).toBe('RATE_LIMIT_EXCEEDED'); expect(limited.headers['retry-after']).toBeTruthy(); } finally { await instance.close(); }
  });

  it('search: fallo del almacén del limitador devuelve 503 y Retry-After', async () => {
    const instance = await app({ VALIDATE_RESPONSES: 'true' });
    const guard = instance.get(RateLimitGuard) as unknown as { windows: Map<string, unknown> };
    const get = jest.spyOn(guard.windows, 'get').mockImplementation(() => { throw new Error('private store failure'); });
    try {
      const response = await request(instance.getHttpServer()).post('/flights/v1/search').set('X-Device-Fingerprint', 'store-failure').send({ itineraries: [{ origin: 'ZZZ', destination: 'YYY', departureDate: '2099-01-01' }], passengers: { adults: 1 } });
      expect(response.status).toBe(503); expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED'); expect(response.headers['retry-after']).toBe('5');
      expect(JSON.stringify(response.body)).not.toContain('private store failure');
    } finally { get.mockRestore(); await instance.close(); }
  });

  it.each([status.UNAVAILABLE, status.DEADLINE_EXCEEDED])('GW-06: gRPC %s ⇒ 503 RATE_LIMIT_EXCEEDED y Retry-After 5', async (failure) => { const instance = await app(); try { grpcFailure = failure; grpcFailureDetails = undefined; const response = await request(instance.getHttpServer()).post('/flights/v1/__test/secured').set('Authorization', token(`unavailable-${failure}`)).set('Idempotency-Key', key()).send({}); expect(response.status).toBe(503); expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED'); expect(response.headers['retry-after']).toBe('5'); } finally { grpcFailure = undefined; grpcFailureDetails = undefined; await instance.close(); } });
  it.each([...PUBLIC_PROBLEM_CODES])('GW-06: código %s conserva su status HTTP del catálogo', async (code) => {
    const expected = code === 'VALIDATION_FAILED' ? 400 : code === 'BOARDING_PASS_NOT_AVAILABLE' || code === 'FLIGHT_STATUS_NOT_AVAILABLE' ? 404 : code === 'RATE_LIMIT_EXCEEDED' ? 429 : code === 'CHANGE_OFFER_EXPIRED' ? 410 : ['INFANT_SEAT_NOT_ALLOWED', 'SEAT_CABIN_MISMATCH', 'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED', 'AMOUNT_MISMATCH', 'CHECK_IN_FAILED'].includes(code) ? 422 : ['PNR_CREATION_FAILED', 'TICKET_ISSUANCE_FAILED'].includes(code) ? 500 : 409;
    const instance = await app(); try { grpcFailure = status.UNKNOWN; grpcFailureDetails = code; const response = await request(instance.getHttpServer()).post('/flights/v1/__test/secured').set('Authorization', token(`catalog-${code}`)).set('Idempotency-Key', key()).send({}); expect(response.status).toBe(expected); expect(response.body.code).toBe(code); } finally { grpcFailure = undefined; grpcFailureDetails = undefined; await instance.close(); }
  }, 30_000);

  it('GW-SEC-04: error inesperado en la app ⇒ 500 genérico sin stack ni mensaje interno', async () => { const instance = await app(); try { const response = await request(instance.getHttpServer()).post('/flights/v1/__test/unexpected').set('Authorization', token()).send({}); expect(response.status).toBe(500); expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' }); expect(JSON.stringify(response.body)).not.toMatch(/forced internal|stack/i); } finally { await instance.close(); } });
  it('GW-SEC-04: logger del Gateway redacta documentNumber, email y Authorization', async () => {
    let output = ''; const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write); const instance = await app(); const rawToken = token('pii').slice(7);
    try { expect((await request(instance.getHttpServer()).post('/flights/v1/__test/secured').set('Authorization', `Bearer ${rawToken}`).set('Idempotency-Key', key()).send({ documentNumber: 'DOC-SECRET-123', email: 'person@example.test' })).status).toBe(201); expect(output).toContain('[REDACTED]'); expect(output).not.toContain('DOC-SECRET-123'); expect(output).not.toContain('person@example.test'); expect(output).not.toContain(rawToken); } finally { await instance.close(); stdout.mockRestore(); }
  });

  it('GW-SEC-03: origen CORS no permitido no recibe Access-Control-Allow-Origin', async () => { const instance = await app({ CORS_ORIGINS: 'https://allowed.test' }); try { expect((await request(instance.getHttpServer()).get('/flights/v1/health').set('Origin', 'https://blocked.test')).headers['access-control-allow-origin']).toBeUndefined(); } finally { await instance.close(); } });
  it('GW-SEC-03: cuerpo de 200 kB ⇒ 413', async () => { const instance = await app(); try { expect((await request(instance.getHttpServer()).post('/flights/v1/search').set('X-Device-Fingerprint', 'body-limit').send({ payload: 'x'.repeat(200_000) })).status).toBe(413); } finally { await instance.close(); } });
  it('GW-SEC-03: X-Forwarded-Proto http ⇒ rechazado y HSTS presente', async () => { const instance = await app(); try { const response = await request(instance.getHttpServer()).get('/flights/v1/health').set('X-Forwarded-Proto', 'http'); expect(response.status).toBe(400); expect(response.headers['strict-transport-security']).toBeTruthy(); } finally { await instance.close(); } });
  it('GW-02/GW-03: petición inválida a /search ⇒ 400 con invalidParams y correlación', async () => { const instance = await app(); try { const response = await request(instance.getHttpServer()).post('/flights/v1/search').set('X-Device-Fingerprint', 'invalid-search').send({}); expect(response.status).toBe(400); expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' }); expect(response.body.invalidParams?.length).toBeGreaterThan(0); expect(response.headers['x-correlation-id']).toBeTruthy(); } finally { await instance.close(); } });
  it('GW-03: X-Correlation-Id está presente en 401 y 404', async () => { const instance = await app(); try { for (const response of [await request(instance.getHttpServer()).post('/flights/v1/__test/secured').send({}), await request(instance.getHttpServer()).get('/flights/v1/missing')]) expect(response.headers['x-correlation-id']).toBeTruthy(); } finally { await instance.close(); } });

  it('GW-01/GW-07/GW-08 keep public middleware and configuration safe', async () => {
    const instance = await app({ RATE_LIMIT_PUBLIC_PER_MIN: '1' }); try { expect((await request(instance.getHttpServer()).get('/flights/v1/health')).status).toBe(200); expect((await request(instance.getHttpServer()).get('/flights/v1/health').set('X-Device-Fingerprint', 'public')).status).toBe(200); expect((await request(instance.getHttpServer()).get('/flights/v1/health').set('X-Device-Fingerprint', 'public')).status).toBe(429); } finally { await instance.close(); }
    expect(configuredGrpcTargets(true, { INVENTORY_GRPC_URL: 'inventory.test:9443', PRICING_GRPC_URL: 'pricing.test:9443' }).find((target) => target.service === 'inventory')).toMatchObject({ url: 'inventory.test:9443', tls: true });
  });
  it('does not expose test routes in production', async () => { const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; const instance = await createGatewayApp(loadConfig({ INTERNAL_API_KEY: 'x'.repeat(32), JWT_ISSUERS: JSON.stringify([{ iss: 'real', aud: 'real', jwksUri: 'https://issuer.example/jwks' }]), NODE_ENV: 'production', DEV_AUTH_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey, PUBLIC_BASE_URL: 'https://gateway.example' })); try { expect((await request(instance.getHttpServer()).post('/flights/v1/__test/secured').send({})).status).toBe(404); } finally { await instance.close(); process.env.NODE_ENV = previous; } });
});
