import { afterAll, describe, expect, it } from '@jest/globals';
import pino from 'pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { PinoAuditLog } from '../src/infrastructure/audit-log';
import { RateLimiter } from '../src/infrastructure/rate-limit';
import { cleanupKeys, FakeGateway, FINGERPRINT, makeApp, operationText, run, tokenFor, UUID_A } from './helpers';

afterAll(cleanupKeys);
const bookingOk = () => ({ status: 200, body: { bookingId: UUID_A, pnr: 'ABC123', status: 'CONFIRMED', grandTotal: { currency: 'USD', total: '1.00' }, createdAt: '2026-11-12T10:00:00Z', passengers: [] } });
const customer = tokenFor('user-1');
const post = (app: ReturnType<typeof makeApp>['app'], body: unknown, headers: Record<string, string> = {}) => { let call = request(app).post('/graphql').set('Content-Type', 'application/json'); for (const [name, value] of Object.entries(headers)) call = call.set(name, value); return call.send(body as object); };
const ECHO_SEARCH = { query: 'query { flightStatus(flightNumber: "FP103", date: "2026-12-01") { flightNumber } }' };

describe('GQL-TRC: trazabilidad', () => {
  it('GQL-TRC-01 el X-Correlation-Id entrante llega IDÉNTICO al Gateway y vuelve en la cabecera y en extensions de los errores', async () => {
    const { app, gateway } = makeApp({}, new FakeGateway(() => ({ status: 409, body: { code: 'SEAT_TAKEN' } })));
    const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer, correlationId: 'corr-abc.123_x' });
    expect(gateway.calls[0].headers['X-Correlation-Id']).toBe('corr-abc.123_x'); expect(reply.headers['x-correlation-id']).toBe('corr-abc.123_x'); expect(reply.body.errors?.[0].extensions.correlationId).toBe('corr-abc.123_x'); expect(reply.headers['x-request-id']).toBeTruthy();
  });
  it('GQL-TRC-02 sin correlation id se genera uno; si supera 100 caracteres o es inseguro se reemplaza (y llega al Gateway el nuevo)', async () => {
    const { app, gateway } = makeApp({}, new FakeGateway(bookingOk));
    const missing = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer }); expect(missing.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    for (const bad of ['x'.repeat(101), 'con espacios y <tags>', 'a/b']) { const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer, correlationId: bad }); expect(reply.headers['x-correlation-id']).not.toBe(bad); expect(reply.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/); }
    expect(gateway.calls.every((call) => /^[A-Za-z0-9._-]{1,100}$/.test(call.headers['X-Correlation-Id'] ?? ''))).toBe(true); expect(new Set(gateway.calls.map((call) => call.headers['X-Request-Id'])).size).toBe(gateway.calls.length);
  });
  it('GQL-TRC-03 X-Device-Fingerprint se valida y se reenvía; una huella insegura no se reenvía', async () => {
    const { app, gateway } = makeApp({}, new FakeGateway(() => ({ status: 200, body: { totalOffers: 0, offers: [] } }))); const input = { itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01' }], passengers: { adults: 1 } };
    await run(app, 'SearchFlights', { input }, { fingerprint: FINGERPRINT }); expect(gateway.calls[0].headers['X-Device-Fingerprint']).toBe(FINGERPRINT);
    const unsafe = await run(app, 'SearchFlights', { input }, { fingerprint: 'huella con espacios <x>' }); expect(unsafe.body.errors?.[0].extensions.code).toBe('VALIDATION_FAILED'); expect(gateway.calls).toHaveLength(1);
  });
});

describe('GQL-SEC: límites, operaciones conocidas, introspección, CORS y registros', () => {
  const deep = (levels: number) => `query D { booking(bookingId: "${UUID_A}") { ${'itineraries { segments { '.repeat(levels)}flightNumber${' } }'.repeat(levels)} } }`;
  it('GQL-SEC-01 profundidad: una consulta que excede MAX_QUERY_DEPTH se rechaza (400) sin llamar al Gateway', async () => {
    const { app, gateway } = makeApp({}, new FakeGateway(bookingOk)); const reply = await post(app, { query: deep(4) }, { Authorization: `Bearer ${customer}` });
    expect(reply.status).toBe(400); expect(reply.body.errors[0].extensions).toMatchObject({ code: 'GRAPHQL_VALIDATION_FAILED' }); expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-SEC-02 complejidad y alias: MAX_COMPLEXITY y MAX_ALIASES se aplican', async () => {
    const { app } = makeApp({ MAX_COMPLEXITY: '30' }); const aliases = Array.from({ length: 16 }, (_, index) => `a${index}: flightStatus(flightNumber: "FP103", date: "2026-12-01") { flightNumber }`).join(' ');
    expect((await post(app, { query: `query { ${aliases} }` })).status).toBe(400);
    const heavy = await post(app, { query: operationText('SearchFlights'), variables: {} }); expect(heavy.status).toBe(400); expect(JSON.stringify(heavy.body)).toContain('GRAPHQL_VALIDATION_FAILED');
  });
  it('GQL-SEC-03 una sola operación por documento y sin batching (arreglo) ni GET', async () => {
    const { app } = makeApp();
    expect((await post(app, { query: 'query A { flightStatus(flightNumber: "FP103", date: "2026-12-01") { flightNumber } } query B { flightStatus(flightNumber: "FP103", date: "2026-12-01") { flightNumber } }' })).status).toBe(400);
    expect((await post(app, [ECHO_SEARCH, ECHO_SEARCH])).status).toBe(400); const get = await request(app).get('/graphql?query={viewer{userId}}'); expect(get.status).toBe(405); expect(get.headers.allow).toBe('POST');
  });
  it('GQL-SEC-04 el cuerpo máximo (100 kB) y las variables (64 kB) se respetan', async () => {
    const { app } = makeApp(); const big = await post(app, { query: ECHO_SEARCH.query, variables: { x: 'a'.repeat(110 * 1024) } }); expect(big.status).toBe(413);
    const smallBody = makeApp({ MAX_VARIABLES_BYTES: '50' }); const vars = await post(smallBody.app, { query: 'query Q($d: Date!) { flightStatus(flightNumber: "FP103", date: $d) { flightNumber } }', variables: { d: '2026-12-01', pad: 'a'.repeat(100) } }); expect(vars.status).toBe(413);
    expect((await request(app).post('/graphql').set('Content-Type', 'application/json').send('{no es json')).status).toBe(400);
  });
  it('GQL-SEC-05 introspección: activa fuera de producción y DESACTIVADA en producción, con las sugerencias «¿quisiste decir…?» retiradas', async () => {
    const dev = makeApp(); expect((await post(dev.app, { query: '{ __schema { queryType { name } } }' })).body.data).toEqual({ __schema: { queryType: { name: 'Query' } } });
    const prod = makeApp({ NODE_ENV: 'production', GATEWAY_BASE_URL: 'https://gateway.example', JWT_ISSUERS: JSON.stringify([{ iss: 'x', aud: 'y', jwksUri: 'https://auth.example/jwks' }]) });
    const reply = await post(prod.app, { query: '{ __schema { queryType { name } } }' }); expect(reply.status).toBe(403); // no es una operación conocida: ni siquiera llega a validarse
    const known = await post(prod.app, { query: operationText('PlatformHealth').replace('nodeId', 'nodeId\n    nodeId'), operationName: 'PlatformHealth' }); expect(known.status).toBe(403);
    const permissive = makeApp({ NODE_ENV: 'production', KNOWN_OPERATIONS_ONLY: 'true', GATEWAY_BASE_URL: 'https://gateway.example', JWT_ISSUERS: JSON.stringify([{ iss: 'x', aud: 'y', jwksUri: 'https://auth.example/jwks' }]) });
    expect(permissive.config.introspection).toBe(false);
  });
  it('GQL-SEC-06 solo operaciones conocidas en producción: las publicadas pasan; una modificada, una nueva o sin nombre se rechazan con 403', async () => {
    const env = { NODE_ENV: 'production', GATEWAY_BASE_URL: 'https://gateway.example', JWT_ISSUERS: JSON.stringify([{ iss: 'x', aud: 'y', jwksUri: 'https://auth.example/jwks' }]) };
    const { app, gateway } = makeApp(env, new FakeGateway(() => ({ status: 200, body: { status: 'HEALTHY', nodo_id: 'N', version: '2', timestamp: '2026-12-01T10:00:00Z', dependencias: [] } })));
    const published = await run(app, 'PlatformHealth'); expect(published.status).toBe(200); expect(published.body.data).toMatchObject({ platformHealth: { status: 'HEALTHY' } }); expect(gateway.calls).toHaveLength(1);
    // Misma operación con otro orden de fragmentos o espacios: el documento canónico es idéntico, sigue permitido.
    const spaced = await post(app, { query: `\n\n${operationText('PlatformHealth').replace(/\n/g, '\n   ')}`, operationName: 'PlatformHealth' }); expect(spaced.status).toBe(200);
    for (const query of ['query PlatformHealth { platformHealth { status } }', 'query Otra { platformHealth { status nodeId } }', '{ platformHealth { status } }']) expect((await post(app, { query })).status).toBe(403);
    expect(gateway.calls).toHaveLength(2);
  });
  it('GQL-SEC-07 CORS: origen permitido ⇒ cabeceras; origen ajeno o sin origen ⇒ ninguna; preflight con las cabeceras permitidas; sin credenciales de cookie', async () => {
    const { app } = makeApp();
    const allowed = await request(app).options('/graphql').set('Origin', 'https://web.example').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type,x-correlation-id,x-device-fingerprint');
    expect(allowed.status).toBe(204); expect(allowed.headers['access-control-allow-origin']).toBe('https://web.example'); expect(allowed.headers['access-control-allow-methods']).toBe('POST,OPTIONS'); expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    const real = await post(app, ECHO_SEARCH, { Origin: 'https://web.example' }); expect(real.headers['access-control-expose-headers']).toContain('X-Correlation-Id'); expect(real.headers['access-control-expose-headers']).toContain('Retry-After');
    expect((await post(app, ECHO_SEARCH, { Origin: 'https://evil.example' })).headers['access-control-allow-origin']).toBeUndefined();
    expect((await post(app, ECHO_SEARCH)).headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).options('/graphql').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST')).headers['access-control-allow-origin']).toBeUndefined();
  });
  it('GQL-SEC-08 sin stack trace en errores forzados (excepción en un resolver, JSON roto, ruta inexistente) y cabeceras de seguridad de helmet', async () => {
    const { app } = makeApp({}, new FakeGateway(() => { throw new Error('boom con /ruta/secreta.ts:12'); }));
    const forcedError = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer }); const missing = await request(app).get('/no-existe'); const broken = await request(app).post('/graphql').set('Content-Type', 'application/json').send('{"query": ');
    for (const reply of [forcedError.body, missing.body, broken.body]) expect(JSON.stringify(reply)).not.toMatch(/stack|boom|secreta|\.ts:|node_modules/);
    expect(missing.status).toBe(404); expect(broken.status).toBe(400); expect(missing.headers['x-content-type-options']).toBe('nosniff'); expect(missing.headers['strict-transport-security']).toBeTruthy(); expect(missing.headers['x-powered-by']).toBeUndefined();
  });
  it('GQL-SEC-09 en producción se rechaza X-Forwarded-Proto: http', async () => {
    const env = { NODE_ENV: 'production', GATEWAY_BASE_URL: 'https://gateway.example', JWT_ISSUERS: JSON.stringify([{ iss: 'x', aud: 'y', jwksUri: 'https://auth.example/jwks' }]) };
    const { app } = makeApp(env); expect((await request(app).get('/health').set('X-Forwarded-Proto', 'http')).status).toBe(400); expect((await request(app).get('/health').set('X-Forwarded-Proto', 'https')).status).toBe(200);
  });
  it('GQL-SEC-10 GET /health es HTTP simple y no llama al Gateway', async () => {
    const { app, gateway } = makeApp(); const reply = await request(app).get('/health'); expect(reply.status).toBe(200); expect(reply.body).toEqual({ status: 'ok' }); expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-SEC-11 límite propio: por huella+IP y por sub; 429 con Retry-After y error RATE_LIMITED; otra huella o usuario no se ve afectado', async () => {
    let now = 1_000_000; const limiter = new RateLimiter(() => now); const { app } = makeApp({ RATE_LIMIT_PER_MIN: '3', RATE_LIMIT_AUTH_PER_MIN: '2' }, new FakeGateway(bookingOk), limiter);
    for (let index = 0; index < 3; index += 1) expect((await post(app, ECHO_SEARCH, { 'X-Device-Fingerprint': FINGERPRINT })).status).toBe(200);
    const blocked = await post(app, ECHO_SEARCH, { 'X-Device-Fingerprint': FINGERPRINT }); expect(blocked.status).toBe(429); expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0); expect(blocked.body.errors[0].extensions).toMatchObject({ category: 'RATE_LIMITED', code: 'RATE_LIMIT_EXCEEDED' });
    expect((await post(app, ECHO_SEARCH, { 'X-Device-Fingerprint': 'otra-huella-0123456789' })).status).toBe(200);
    now += 61_000; expect((await post(app, ECHO_SEARCH, { 'X-Device-Fingerprint': FINGERPRINT })).status).toBe(200);
    const auth = { Authorization: `Bearer ${customer}` }; const op = { query: 'query { viewer { userId } }' }; const subs = makeApp({ RATE_LIMIT_PER_MIN: '100', RATE_LIMIT_AUTH_PER_MIN: '2' }, new FakeGateway(bookingOk), new RateLimiter(() => now));
    expect((await post(subs.app, op, auth)).status).toBe(200); expect((await post(subs.app, op, auth)).status).toBe(200); expect((await post(subs.app, op, auth)).status).toBe(429); expect((await post(subs.app, op, { Authorization: `Bearer ${tokenFor('user-2')}` })).status).toBe(200);
  });
  it('GQL-SEC-13 con sesión el límite es por sub (usuarios que comparten IP no se pisan) y un token falso no evita el límite por huella+IP', async () => {
    const { app } = makeApp({ RATE_LIMIT_PER_MIN: '2', RATE_LIMIT_AUTH_PER_MIN: '50' }, new FakeGateway(bookingOk), new RateLimiter(() => 1_000_000)); const op = { query: 'query { viewer { userId } }' };
    for (let index = 0; index < 6; index += 1) expect((await post(app, op, { Authorization: `Bearer ${tokenFor(`user-${index}`)}` })).status).toBe(200); // misma IP, sin huella: no comparten cupo
    for (let index = 0; index < 5; index += 1) expect((await post(app, op, { Authorization: `Bearer ${tokenFor('user-same')}` })).status).toBe(200);
    const statuses: number[] = []; for (let index = 0; index < 4; index += 1) statuses.push((await post(app, ECHO_SEARCH, { Authorization: 'Bearer token.falso.xx' })).status);
    expect(statuses).toContain(429);
  });
  it('GQL-SEC-12 registros por lista blanca: ningún token, variables, documento, correo, teléfono, nombres ni paymentReference llegan al log', async () => {
    const lines: string[] = []; const logger = pino({}, new Writable({ write(chunk, _encoding, callback) { lines.push(String(chunk)); callback(); } }));
    const { app, config } = makeApp({}, new FakeGateway(bookingOk)); void config;
    const { createApp } = await import('../src/infrastructure/app'); const { buildServiceSchema } = await import('../src/infrastructure/schema'); const { JoseTokenVerifier } = await import('../src/infrastructure/jwt-verifier'); const { knownOperations } = await import('@flight-platform/graphql-schema'); const { loadConfig } = await import('../src/config'); const { baseEnv } = await import('./helpers');
    const cfg = loadConfig(baseEnv); const logged = createApp({ config: cfg, schema: buildServiceSchema(), gateway: new FakeGateway(bookingOk), verifier: new JoseTokenVerifier(cfg.jwtIssuers), known: knownOperations(), log: new PinoAuditLog(logger) });
    const passenger = { passengerId: 'PAX-1', passengerType: 'ADULT', firstName: 'Nombre-Secreto', lastName: 'Apellido-Secreto', documentType: 'PASSPORT', documentNumber: 'DOC-SECRETO-99', nationality: 'EC', birthDate: '1990-01-01', gender: 'F', contact: { email: 'correo-secreto@example.test', phone: '+593911112222' } };
    const reply = await run(logged, 'CreateBooking', { input: { holdId: UUID_A, passengers: [passenger], paymentReference: 'pay_ok_REF-SECRETA' }, idempotencyKey: UUID_A }, { token: customer, correlationId: 'corr-log-1', fingerprint: FINGERPRINT }); expect(reply.status).toBe(200);
    const text = lines.join('\n'); expect(text).toContain('corr-log-1'); expect(text).toContain('CreateBooking');
    for (const secret of [customer, 'Nombre-Secreto', 'Apellido-Secreto', 'DOC-SECRETO-99', 'correo-secreto', '+593911112222', 'REF-SECRETA', 'variables', 'Authorization', 'user-1', FINGERPRINT]) expect({ secret, found: text.includes(secret) }).toEqual({ secret, found: false });
    void app;
  });
});
