import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, importPKCS8, jwtVerify, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ALL_SCOPES, expectSchema, expectV2Response, fetchToken, registerClient, startHealthStubs, startTestGateway, type TestGateway } from './support';

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
const form = { grant_type: 'client_credentials' };

describe('F12a P1 · dev-auth, seguridad y trazabilidad v2', () => {
  let gw: TestGateway;
  beforeAll(async () => { gw = await startTestGateway({ DEV_AUTH_FAILURE_LIMIT_PER_MIN: '4' }); }, 60_000);
  afterAll(async () => { await gw?.close(); });

  describe('emisión de tokens (POST /api/v2/oauth2/token)', () => {
    it('V2-P1-01 emite un token con client_id y client_secret en el cuerpo (form)', async () => {
      const client = await registerClient(gw.store, ['flights:read', 'flights:book']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: client.secret });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'flights:read flights:book' });
      expect(typeof res.body.access_token).toBe('string');
    });
    it('V2-P1-02 emite un token con autenticación HTTP Basic', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').set('Authorization', basic(client.clientId, client.secret)).type('form').send(form);
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('flights:read');
    });
    it('V2-P1-03 emite un token con cuerpo JSON', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').send({ ...form, client_id: client.clientId, client_secret: client.secret });
      expect(res.status).toBe(200);
    });
    it('V2-P1-04 limita el token al subconjunto de scopes pedido', async () => {
      const client = await registerClient(gw.store, ['flights:read', 'flights:book', 'flights:cancel']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: client.secret, scope: 'flights:book' });
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('flights:book');
      expect(decodeJwt(res.body.access_token).scope).toBe('flights:book');
    });
    it('V2-P1-05 rechaza un scope que el cliente no tiene con invalid_scope', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: client.secret, scope: 'flights:admin' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_scope');
    });
    it('V2-P1-06 rechaza un scope inexistente con invalid_scope', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: client.secret, scope: 'flights:read root' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_scope');
    });
    it('V2-P1-07 rechaza un secreto incorrecto con invalid_client sin revelar el secreto', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: 'wrong-secret-value' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
      expect(JSON.stringify(res.body)).not.toContain('wrong-secret-value');
    });
    it('V2-P1-08 responde igual para un cliente inexistente y para un secreto incorrecto', async () => {
      const known = await registerClient(gw.store, ['flights:read']);
      const wrong = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: known.clientId, client_secret: 'x'.repeat(20) });
      const unknown = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: 'does-not-exist', client_secret: 'x'.repeat(20) });
      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body).toEqual(wrong.body);
    });
    it('V2-P1-09 con Basic inválido responde 401 con WWW-Authenticate', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').set('Authorization', basic(client.clientId, 'nope-nope-nope')).type('form').send(form);
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/^Basic/);
    });
    it('V2-P1-10 rechaza un grant_type distinto de client_credentials', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ grant_type: 'password', client_id: client.clientId, client_secret: client.secret });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_grant_type');
    });
    it('V2-P1-11 rechaza la petición sin credenciales', async () => {
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send(form);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });
    it('V2-P1-12 rechaza un cliente desactivado', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      await gw.store.setActive(client.clientId, false);
      const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: client.secret });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });
    it('V2-P1-13 bloquea con 429 tras demasiados intentos fallidos del mismo cliente y no revela si el secreto era válido', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const bad = () => request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: 'y'.repeat(24) });
      for (let i = 0; i < 4; i += 1) expect((await bad()).status).toBe(401);
      const blocked = await bad();
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBe('60');
      const correct = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: client.secret });
      expect(correct.status).toBe(429);
    });
    it('V2-P1-14 el secreto se guarda con scrypt y nunca en claro', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const stored = await gw.store.find(client.clientId);
      expect(stored?.secretHash).toMatch(/^scrypt\$/);
      expect(JSON.stringify(stored)).not.toContain(client.secret);
    });
  });

  describe('token y JWKS (GET /api/v2/.well-known/jwks.json)', () => {
    it('V2-P1-15 el JWKS publica solo la llave pública con kid y alg RS256', async () => {
      const res = await request(gw.server).get('/api/v2/.well-known/jwks.json');
      expect(res.status).toBe(200);
      expect(res.body.keys).toHaveLength(1);
      const [key] = res.body.keys;
      expect(key).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
      expect(typeof key.kid).toBe('string');
      for (const secretMember of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(key).not.toHaveProperty(secretMember);
    });
    it('V2-P1-16 un tercero verifica el token solo con el JWKS publicado', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const token = await fetchToken(gw.server, client);
      const jwks = (await request(gw.server).get('/api/v2/.well-known/jwks.json')).body;
      const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(jwks), { issuer: 'http://gateway.test/api/v2', audience: 'flight-platform' });
      expect(protectedHeader.kid).toBe(jwks.keys[0].kid);
      expect(payload).toMatchObject({ sub: client.clientId, app_role: 'partner', client_id: client.clientId, scope: 'flights:read' });
    });
    it('V2-P1-17 el token vence según expires_in', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const decoded = decodeJwt(await fetchToken(gw.server, client));
      expect((decoded.exp as number) - (decoded.iat as number)).toBe(3600);
      expect(typeof decoded.jti).toBe('string');
    });
  });

  describe('autenticación y autorización en rutas protegidas', () => {
    it('V2-P1-18 sin token responde 401 UNAUTHORIZED con ProblemDetails v2', async () => {
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('X-Correlation-Id', 'corr-p1-18');
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED', instance: '/api/v2/__test/whoami', correlation_id: 'corr-p1-18' });
      expect(typeof res.body.timestamp).toBe('string');
      expectSchema('ProblemDetails', res.body);
    });
    it('V2-P1-19 con un token sin el scope requerido responde 403 FORBIDDEN', async () => {
      const client = await registerClient(gw.store, ['flights:hold']);
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${await fetchToken(gw.server, client)}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expectSchema('ProblemDetails', res.body);
    });
    it('V2-P1-20 con un token manipulado responde 401', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const token = await fetchToken(gw.server, client); const [head, body, sig] = token.split('.');
      const forged = `${head}.${Buffer.from(JSON.stringify({ ...decodeJwt(token), scope: 'flights:admin' })).toString('base64url')}.${sig}`;
      expect(body).not.toBe(forged.split('.')[1]);
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
      expectSchema('ProblemDetails', res.body);
    });
    it('V2-P1-21 rechaza un token vencido (más allá de la tolerancia de reloj)', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const key = await importPKCS8(gw.devKeyPem, 'RS256'); const now = Math.floor(Date.now() / 1000);
      const expired = await new SignJWT({ scope: 'flights:read', app_role: 'partner' }).setProtectedHeader({ alg: 'RS256' }).setIssuer('http://gateway.test/api/v2').setAudience('flight-platform').setSubject(client.clientId).setIssuedAt(now - 7200).setExpirationTime(now - 3600).sign(key);
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });
    it('V2-P1-22 rechaza un token con otro emisor o audiencia aunque esté bien firmado', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const key = await importPKCS8(gw.devKeyPem, 'RS256'); const now = Math.floor(Date.now() / 1000);
      const sign = (iss: string, aud: string) => new SignJWT({ scope: 'flights:read', app_role: 'partner' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(iss).setAudience(aud).setSubject(client.clientId).setIssuedAt(now).setExpirationTime(now + 600).sign(key);
      expect((await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${await sign('http://evil.test/api/v2', 'flight-platform')}`)).status).toBe(401);
      expect((await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${await sign('http://gateway.test/api/v2', 'other')}`)).status).toBe(401);
    });
    it('V2-P1-23 un cliente desactivado pierde el acceso con sus tokens ya emitidos', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const token = await fetchToken(gw.server, client);
      expect((await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      await gw.store.setActive(client.clientId, false); gw.devAuth.invalidateClient(client.clientId);
      expect((await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    });
    it('V2-P1-24 un token emitido por la llave del dev-auth no vale con un clientId inexistente', async () => {
      const key = await importPKCS8(gw.devKeyPem, 'RS256'); const now = Math.floor(Date.now() / 1000);
      const ghost = await new SignJWT({ scope: 'flights:read', app_role: 'partner' }).setProtectedHeader({ alg: 'RS256' }).setIssuer('http://gateway.test/api/v2').setAudience('flight-platform').setSubject('ghost-client').setIssuedAt(now).setExpirationTime(now + 600).sign(key);
      expect((await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${ghost}`)).status).toBe(401);
    });
    it('V2-P1-25 un token alg=none no se acepta', async () => {
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', app_role: 'partner', scope: 'flights:read', iss: 'http://gateway.test/api/v2', aud: 'flight-platform', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.`;
      expect((await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${unsigned}`)).status).toBe(401);
    });
    it('V2-P1-26 anyScope acepta flights:ops o flights:admin y rechaza el resto', async () => {
      const ops = await registerClient(gw.store, ['flights:ops']); const admin = await registerClient(gw.store, ['flights:admin']); const reader = await registerClient(gw.store, ['flights:read']);
      const call = async (client: typeof ops) => (await request(gw.server).get('/api/v2/__test/ops').set('Authorization', `Bearer ${await fetchToken(gw.server, client)}`)).status;
      expect(await call(ops)).toBe(200); expect(await call(admin)).toBe(200); expect(await call(reader)).toBe(403);
    });
  });

  describe('dueño compuesto (D1) y X-User-Id', () => {
    it('V2-P1-27 con token de partner el dueño es <clientId>~<X-User-Id>', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${await fetchToken(gw.server, client)}`).set('X-User-Id', 'user-123');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ownerId: `${client.clientId}~user-123`, role: 'partner', clientId: client.clientId });
    });
    it('V2-P1-28 sin X-User-Id el dueño es el propio clientId', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${await fetchToken(gw.server, client)}`);
      expect(res.body.ownerId).toBe(client.clientId);
    });
    it('V2-P1-29 dos clientes con el mismo X-User-Id tienen dueños distintos', async () => {
      const a = await registerClient(gw.store, ['flights:read']); const b = await registerClient(gw.store, ['flights:read']);
      const owner = async (client: typeof a) => (await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${await fetchToken(gw.server, client)}`).set('X-User-Id', 'shared-user')).body.ownerId;
      expect(await owner(a)).not.toBe(await owner(b));
    });
    it('V2-P1-30 Booking no puede suplantar a un usuario de Supabase: un X-User-Id con ~ o con el sub ajeno nunca produce el sub ajeno', async () => {
      const client = await registerClient(gw.store, ['flights:read']);
      const victim = '5f1d2c3b-aaaa-bbbb-cccc-0123456789ab';
      const token = await fetchToken(gw.server, client);
      const direct = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${token}`).set('X-User-Id', victim);
      expect(direct.body.ownerId).toBe(`${client.clientId}~${victim}`);
      expect(direct.body.ownerId).not.toBe(victim);
      const tilde = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${token}`).set('X-User-Id', `other-client~${victim}`);
      expect(tilde.status).toBe(400);
      expectSchema('ProblemDetails', tilde.body);
    });
    it('V2-P1-31 con un token que no es de partner X-User-Id se ignora y el dueño es el sub', async () => {
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${gw.customerToken('supabase-user-1', 'flights:read')}`).set('X-User-Id', 'someone-else');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ownerId: 'supabase-user-1', role: 'customer', clientId: null });
    });
    it('V2-P1-32 rechaza un X-User-Id vacío, demasiado largo o con caracteres no permitidos', async () => {
      const client = await registerClient(gw.store, ['flights:read']); const token = await fetchToken(gw.server, client);
      for (const value of ['', 'a'.repeat(65), 'user id', 'user/../x', 'a;b']) {
        const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${token}`).set('X-User-Id', value);
        expect({ value, status: res.status }).toEqual({ value, status: 400 });
      }
    });
    it('V2-P1-33 el dueño compuesto cabe en el límite de 128 caracteres de los servicios', async () => {
      const client = await registerClient(gw.store, ['flights:read'], 'c'.repeat(40));
      const res = await request(gw.server).get('/api/v2/__test/whoami').set('Authorization', `Bearer ${await fetchToken(gw.server, client)}`).set('X-User-Id', 'u'.repeat(64));
      expect(res.status).toBe(200);
      expect(res.body.ownerId.length).toBeLessThanOrEqual(128);
    });
  });

  describe('trazabilidad y errores transversales', () => {
    it('V2-P1-34 devuelve X-Correlation-Id propagado y genera X-Request-Id', async () => {
      const res = await request(gw.server).get('/api/v2/vuelos/health').set('X-Correlation-Id', 'corr-p1-34');
      expect(res.headers['x-correlation-id']).toBe('corr-p1-34');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
    it('V2-P1-35 respeta un X-Request-Id válido del cliente', async () => {
      const res = await request(gw.server).get('/api/v2/vuelos/health').set('X-Request-Id', 'req-p1-35');
      expect(res.headers['x-request-id']).toBe('req-p1-35');
    });
    it('V2-P1-36 genera un X-Correlation-Id si no llega', async () => {
      const res = await request(gw.server).get('/api/v2/vuelos/health');
      expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
    it('V2-P1-37 rechaza un X-Correlation-Id de más de 100 caracteres con 400 ProblemDetails', async () => {
      const res = await request(gw.server).get('/api/v2/vuelos/health').set('X-Correlation-Id', 'c'.repeat(101));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expectSchema('ProblemDetails', res.body);
    });
    it('V2-P1-38 una ruta inexistente responde 404 NOT_FOUND con ProblemDetails', async () => {
      const res = await request(gw.server).get(`/api/v2/vuelos/${randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expectSchema('ProblemDetails', res.body);
    });
    it('V2-P1-39 un JSON mal formado responde 400 ProblemDetails sin eco del cuerpo', async () => {
      const res = await request(gw.server).post('/api/v2/oauth2/token').set('Content-Type', 'application/json').send('{"client_secret": "leak-me"');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('leak-me');
      expectSchema('ProblemDetails', res.body);
    });
    it('V2-P1-40 el 429 del rate limit lleva Retry-After y ProblemDetails v2', async () => {
      const limited = await startTestGateway({ RATE_LIMIT_PUBLIC_PER_MIN: '2' });
      try {
        const publics = [] as Array<{ status: number; body: unknown; retry?: string }>;
        for (let i = 0; i < 4; i += 1) { const r = await request(limited.server).get('/api/v2/vuelos/health').set('X-Device-Fingerprint', 'fp-p1-40'); publics.push({ status: r.status, body: r.body, retry: r.headers['retry-after'] }); }
        const blocked = publics.find((entry) => entry.status === 429);
        expect(blocked).toBeDefined();
        expect(Number(blocked!.retry)).toBeGreaterThanOrEqual(1);
        expectSchema('ProblemDetails', blocked!.body);
      } finally { await limited.close(); }
    });
  });

  describe('GET /api/v2/vuelos/health', () => {
    it('V2-P1-41 con los siete servicios SERVING responde 200 HEALTHY y cumple VuelosHealthResponse', async () => {
      const stubs = await startHealthStubs(); const g = await startTestGateway({ HEALTH_CACHE_MS: '0' });
      try {
        const res = await request(g.server).get('/api/v2/vuelos/health');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'HEALTHY', nodo_id: 'NODE_VUE_GABATAIR', nombre_proveedor: 'GabatAIR', vertical: 'VUELOS', version: '2.0.0', circuit_breaker_estado: 'CLOSED' });
        expect(res.body.dependencias).toHaveLength(7);
        expect(res.body.dependencias.every((d: { status: string }) => d.status === 'UP')).toBe(true);
        expectV2Response('GET', '/vuelos/health', 200, res.body);
      } finally { await g.close(); stubs.restore(); }
    }, 30_000);
    it('V2-P1-42 no exige token', async () => {
      const stubs = await startHealthStubs(); const g = await startTestGateway({ HEALTH_CACHE_MS: '0' });
      try { expect((await request(g.server).get('/api/v2/vuelos/health')).status).toBe(200); } finally { await g.close(); stubs.restore(); }
    }, 30_000);
    it('V2-P1-43 con Webhooks caído responde 200 DEGRADED', async () => {
      const stubs = await startHealthStubs(); const g = await startTestGateway({ HEALTH_CACHE_MS: '0' });
      try {
        await stubs.stop('webhooks');
        const res = await request(g.server).get('/api/v2/vuelos/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('DEGRADED');
        expect(res.body.dependencias.find((d: { nombre: string }) => d.nombre === 'webhooks-service').status).toBe('DOWN');
        expectV2Response('GET', '/vuelos/health', 200, res.body);
      } finally { await g.close(); stubs.restore(); }
    }, 30_000);
    it('V2-P1-44 con Inventory caído responde 503 DOWN con el mismo esquema de cuerpo', async () => {
      const stubs = await startHealthStubs(); const g = await startTestGateway({ HEALTH_CACHE_MS: '0' });
      try {
        await stubs.stop('inventory');
        const res = await request(g.server).get('/api/v2/vuelos/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('DOWN');
        expectV2Response('GET', '/vuelos/health', 503, res.body);
      } finally { await g.close(); stubs.restore(); }
    }, 30_000);
    it('V2-P1-45 con Pricing o Reservation caídos también responde DOWN', async () => {
      for (const name of ['pricing', 'reservation']) {
        const stubs = await startHealthStubs(); const g = await startTestGateway({ HEALTH_CACHE_MS: '0' });
        try { await stubs.stop(name); const res = await request(g.server).get('/api/v2/vuelos/health'); expect({ name, status: res.status, body: res.body.status }).toEqual({ name, status: 503, body: 'DOWN' }); }
        finally { await g.close(); stubs.restore(); }
      }
    }, 60_000);
    it('V2-P1-46 responde en menos de 1 s aunque ningún servicio acepte conexiones', async () => {
      const g = await startTestGateway({ HEALTH_CACHE_MS: '0', INVENTORY_GRPC_URL: undefined });
      const prior = new Map<string, string | undefined>();
      for (const name of ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks']) { const variable = `${name.toUpperCase()}_GRPC_URL`; prior.set(variable, process.env[variable]); process.env[variable] = '127.0.0.1:1'; }
      try {
        const started = Date.now(); const res = await request(g.server).get('/api/v2/vuelos/health'); const elapsed = Date.now() - started;
        expect(res.status).toBe(503);
        expect(elapsed).toBeLessThan(1000);
      } finally { await g.close(); for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    }, 30_000);
    it('V2-P1-47 el resultado se reutiliza dentro de la caché y se refresca al vencer', async () => {
      const stubs = await startHealthStubs(); const g = await startTestGateway({ HEALTH_CACHE_MS: '600' });
      try {
        expect((await request(g.server).get('/api/v2/vuelos/health')).body.status).toBe('HEALTHY');
        await stubs.stop('inventory');
        expect((await request(g.server).get('/api/v2/vuelos/health')).body.status).toBe('HEALTHY');
        await delay(700);
        expect((await request(g.server).get('/api/v2/vuelos/health')).body.status).toBe('DOWN');
      } finally { await g.close(); stubs.restore(); }
    }, 30_000);
    it('V2-P1-48 usa NODE_ID y PROVIDER_NAME configurados', async () => {
      const stubs = await startHealthStubs(); const g = await startTestGateway({ HEALTH_CACHE_MS: '0', NODE_ID: 'NODE_VUE_OTRA', PROVIDER_NAME: 'Otra' });
      try { const res = await request(g.server).get('/api/v2/vuelos/health'); expect(res.body).toMatchObject({ nodo_id: 'NODE_VUE_OTRA', nombre_proveedor: 'Otra' }); } finally { await g.close(); stubs.restore(); }
    }, 30_000);
  });

  it('V2-P1-49 el cliente de prueba recibe scopes completos si no pide ninguno', async () => {
    const client = await registerClient(gw.store, ALL_SCOPES);
    const res = await request(gw.server).post('/api/v2/oauth2/token').type('form').send({ ...form, client_id: client.clientId, client_secret: client.secret });
    expect(res.body.scope.split(' ').sort()).toEqual([...ALL_SCOPES].sort());
    expect(decodeProtectedHeader(res.body.access_token).alg).toBe('RS256');
  });
});
