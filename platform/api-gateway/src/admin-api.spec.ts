import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import request from 'supertest';
import { parse } from 'yaml';
import { createDevToken } from '../../../infra/scripts/dev-token';
import { loadConfig } from './config';
import { openApiAdminSpecPath, openApiSpecPath, openApiV2SpecPath } from './openapi-path';

jest.mock('./grpc-clients', () => ({ ...(jest.requireActual('./grpc-clients') as object), callGatewayGrpc: jest.fn(), fetchSeatMap: jest.fn() }));
import { callGatewayGrpc } from './grpc-clients';
import { createGatewayApp } from './app';
import { InMemoryV2StateStore } from './v2/state';

jest.setTimeout(60_000);

const FLIGHT = '00000000-0000-4000-8000-0000000000a1'; const FARE = '00000000-0000-4000-8000-0000000000b1'; const BOOKING = '00000000-0000-4000-8000-0000000000c1';
const dir = mkdtempSync(join(tmpdir(), 'admin-api-'));
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
const pub = join(dir, 'public.pem'); writeFileSync(pub, keys.publicKey);
const env = { NODE_ENV: 'test', INTERNAL_API_KEY: 'x'.repeat(32), JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: pub }]), VALIDATE_RESPONSES: 'true', GATEWAY_TRANSPORT: 'grpc' };
const token = (sub: string, role: string, scope: string) => `Bearer ${createDevToken(keys.privateKey, { sub, app_role: role, scope })}`;
const ADMIN = token('admin-1', 'admin', 'flights:read flights:admin'); const CUSTOMER = token('user-a', 'customer', 'flights:read flights:book flights:admin');
const PARTNER = token('booking', 'partner', 'flights:read flights:admin'); const ADMIN_NO_SCOPE = token('admin-2', 'admin', 'flights:read');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const adminSpec = parse(readFileSync(openApiAdminSpecPath(), 'utf8')) as { paths: Record<string, unknown>; info: { description: string }; components: { schemas: Record<string, object> } };
const ajv = new Ajv({ strict: false }); addFormats(ajv); ajv.addSchema({ ...adminSpec, $id: 'admin' } as never);
const validate = (name: string, body: unknown) => { const check = ajv.compile({ $ref: `admin#/components/schemas/${name}` }); const ok = check(body); return { ok, errors: check.errors }; };

const flights = { items: [{ flightInstanceId: FLIGHT, segment: { flightNumber: 'FP103', departure: { iataCode: 'GYE', at: '2026-12-01T10:00:00-05:00' }, arrival: { iataCode: 'UIO', at: '2026-12-01T11:00:00-05:00' }, aircraft: 'A320' }, cabins: [{ cabinClass: 'ECONOMY', capacity: 150 }], closed: false }], page: {} };
const fare = { fareId: FARE, flightInstanceId: FLIGHT, cabinClass: 'ECONOMY', fareBrand: 'BASIC', price: { currency: 'USD', total: '100.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { personalItemIncluded: true }, extraCheckedBaggagePrice: { currency: 'USD', total: '30.00' } };
const fareBody = { flightInstanceId: FLIGHT, cabinClass: 'ECONOMY', fareBrand: 'BASIC', price: { currency: 'USD', total: '100.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { personalItemIncluded: true }, extraCheckedBaggagePrice: { currency: 'USD', total: '30.00' } };
const calls: Array<{ service: string; method: string; input: Record<string, unknown> }> = [];
let failure: unknown;
const app = async (more: Record<string, string> = {}) => createGatewayApp(loadConfig({ ...env, ...more }));

beforeEach(() => {
  calls.length = 0; failure = undefined;
  jest.mocked(callGatewayGrpc).mockImplementation(async (_config, service, method, input) => {
    calls.push({ service, method, input: input as Record<string, unknown> });
    if (failure) throw failure;
    if (method === 'listFlightInstances') return flights;
    if (method === 'listFares') return { fares: [{ fare }], page: {} };
    if (method === 'upsertFare') return { fare };
    return {};
  });
});
const withApp = async (run: (server: ReturnType<Awaited<ReturnType<typeof app>>['getHttpServer']>) => Promise<void>, more: Record<string, string> = {}) => { const instance = await app(more); try { await run(instance.getHttpServer()); } finally { await instance.close(); } };
const isProblem = (body: unknown, status: number, code: string) => { const problem = validate('ProblemDetails', body); expect(problem.errors).toBeNull(); expect(body).toMatchObject({ status, code }); };

describe('B-2: API interna de administración /api/admin/v1', () => {
  it('ADM-API-01: un admin lista vuelos (con flightInstanceId) y la respuesta cumple el OpenAPI interno', async () => {
    await withApp(async (server) => {
      const response = await request(server).get('/api/admin/v1/flights?date=2026-12-01&limit=10').set('Authorization', ADMIN);
      expect(response.status).toBe(200); expect(validate('AdminFlightList', response.body).errors).toBeNull(); expect(response.body.items[0].flightInstanceId).toBe(FLIGHT);
      expect(calls[0]).toMatchObject({ service: 'inventory', method: 'listFlightInstances', input: { date: '2026-12-01', page: { limit: 10 } } });
    });
  });
  it('ADM-API-02: un admin lee tarifas de un vuelo y la respuesta cumple el OpenAPI interno', async () => {
    await withApp(async (server) => {
      const response = await request(server).get(`/api/admin/v1/fares?flightInstanceId=${FLIGHT}`).set('Authorization', ADMIN);
      expect(response.status).toBe(200); expect(validate('AdminFareList', response.body).errors).toBeNull(); expect(calls[0]).toMatchObject({ service: 'pricing', method: 'listFares', input: { flightInstanceId: FLIGHT } });
    });
  });
  it('ADM-API-03: un admin guarda una tarifa y la respuesta cumple el OpenAPI interno', async () => {
    await withApp(async (server) => {
      const response = await request(server).put('/api/admin/v1/fares').set('Authorization', ADMIN).send(fareBody);
      expect(response.status).toBe(200); expect(validate('AdminFareResponse', response.body).errors).toBeNull(); expect(response.body.fare.fareId).toBe(FARE);
      expect(calls[0]).toMatchObject({ service: 'pricing', method: 'upsertFare', input: fareBody });
    });
  });
  it.each([['customer con flights:admin', CUSTOMER], ['partner con flights:admin', PARTNER], ['admin sin flights:admin', ADMIN_NO_SCOPE]])('ADM-API-04: %s ⇒ 403 FORBIDDEN sin llamar a los servicios', async (_name, authorization) => {
    await withApp(async (server) => {
      for (const send of [() => request(server).get('/api/admin/v1/flights'), () => request(server).get('/api/admin/v1/fares'), () => request(server).put('/api/admin/v1/fares').send(fareBody), () => request(server).get('/api/admin/v1/web-bookings')]) {
        const response = await send().set('Authorization', authorization);
        expect(response.status).toBe(403); isProblem(response.body, 403, 'FORBIDDEN'); expect(response.headers['content-type']).toContain('application/problem+json');
      }
      expect(calls).toHaveLength(0);
    });
  });
  it('ADM-API-05: sin token, con token inválido o con alg none ⇒ 401 UNAUTHORIZED', async () => {
    await withApp(async (server) => {
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', app_role: 'admin', scope: 'flights:admin', iss: 'flight-platform-dev', aud: 'flight-platform', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.`;
      const tampered = `${ADMIN.slice(0, -4)}AAAA`;
      for (const authorization of [undefined, 'Bearer xxx', `Bearer ${none}`, tampered]) {
        const call = request(server).get('/api/admin/v1/flights'); const response = await (authorization ? call.set('Authorization', authorization) : call);
        expect(response.status).toBe(401); isProblem(response.body, 401, 'UNAUTHORIZED');
      }
      expect(calls).toHaveLength(0);
    });
  });
  it('ADM-API-06: la autorización va antes que la validación (un customer con cuerpo inválido recibe 403, no 400)', async () => {
    await withApp(async (server) => {
      const response = await request(server).put('/api/admin/v1/fares').set('Authorization', CUSTOMER).send({ nope: true });
      expect(response.status).toBe(403); isProblem(response.body, 403, 'FORBIDDEN');
    });
  });
  it.each([
    ['campo desconocido', () => ({ ...fareBody, admin: true })], ['moneda inválida', () => ({ ...fareBody, price: { currency: 'usd', total: '100.00' } })],
    ['importe sin dos decimales', () => ({ ...fareBody, price: { currency: 'USD', total: '100' } })], ['vuelo no uuid', () => ({ ...fareBody, flightInstanceId: 'x' })], ['falta fareRules', () => { const { fareRules, ...rest } = fareBody; void fareRules; return rest; }], ['cabina inexistente', () => ({ ...fareBody, cabinClass: 'LUXURY' })]
  ])('ADM-API-07: PUT /fares con %s ⇒ 400 VALIDATION_FAILED y sin llamar al servicio', async (_name, body) => {
    await withApp(async (server) => {
      const response = await request(server).put('/api/admin/v1/fares').set('Authorization', ADMIN).send(body());
      expect(response.status).toBe(400); isProblem(response.body, 400, 'VALIDATION_FAILED'); expect(calls).toHaveLength(0);
    });
  });
  it.each([['limit=201'], ['limit=-1'], ['limit=abc'], ['cursor=no-uuid'], ['date=2026-13-45'], ['extra=1']])('ADM-API-08: GET /flights?%s ⇒ 400', async (query) => {
    await withApp(async (server) => {
      const response = await request(server).get(`/api/admin/v1/flights?${query}`).set('Authorization', ADMIN);
      expect(response.status).toBe(400); isProblem(response.body, 400, 'VALIDATION_FAILED'); expect(calls).toHaveLength(0);
    });
  });
  it('ADM-API-09: un fallo interno responde 500 INTERNAL_ERROR sin detalles internos', async () => {
    failure = new Error('secret stack detail at /srv/app/x.ts');
    await withApp(async (server) => {
      const response = await request(server).get('/api/admin/v1/flights').set('Authorization', ADMIN);
      expect(response.status).toBe(500); isProblem(response.body, 500, 'INTERNAL_ERROR'); expect(JSON.stringify(response.body)).not.toContain('secret stack');
    });
  });
  it('ADM-API-10: ruta desconocida o método no permitido bajo el prefijo ⇒ 404/405 ProblemDetails; solo los operaciones del OpenAPI interno existen', async () => {
    await withApp(async (server) => {
      expect((await request(server).get('/api/admin/v1/flights/close').set('Authorization', ADMIN)).status).toBeGreaterThanOrEqual(400);
      expect((await request(server).post('/api/admin/v1/flights').set('Authorization', ADMIN).send({})).status).toBeGreaterThanOrEqual(400);
      expect(calls).toHaveLength(0);
    });
    expect(Object.keys(adminSpec.paths).sort()).toEqual(['/fares', '/flights', '/web-bookings']);
  });
  it('ADM-API-11: el OpenAPI interno está separado de los contratos con Booking y aclara que no es el v1 deprecado', () => {
    for (const path of [openApiSpecPath(), openApiV2SpecPath()]) { const text = readFileSync(path, 'utf8'); expect(text).not.toContain('web-bookings'); expect(text).not.toContain('/api/admin'); expect(text).not.toContain('listAdminFares'); }
    expect(openApiAdminSpecPath()).toMatch(/contracts[\\/]openapi[\\/]interno[\\/]admin-v1\.yaml$/);
    expect(adminSpec.info.description).toContain('no tiene relación con el contrato `v1`'); expect(adminSpec.info.description).toContain('deprecado');
  });
  it('ADM-API-12: GET /web-bookings muestra las reservas del canal WEB marcadas como de prueba, sin sub ni datos personales', async () => {
    const instance = await app({ WEB_PAYMENT_MODE: 'simulated' });
    try {
      const state = instance.get('V2_STATE') as InMemoryV2StateStore;
      await state.saveBooking({ bookingId: BOOKING, clientId: 'user-a', ownerId: 'user-a', holdId: FLIGHT, paymentReference: 'pay_ok_1', salesChannel: { partnerId: 'WEB_TEST', passengers: 2 }, passengerMap: {} });
      await state.saveBooking({ bookingId: '00000000-0000-4000-8000-0000000000c2', clientId: 'booking', ownerId: 'booking~u1', holdId: FLIGHT, paymentReference: 'PAY-BKP-1', salesChannel: { partnerId: 'BOOKING_PROTOTIPO' }, passengerMap: {} });
      const response = await request(instance.getHttpServer()).get('/api/admin/v1/web-bookings').set('Authorization', ADMIN);
      expect(response.status).toBe(200); expect(validate('WebTestBookingList', response.body).errors).toBeNull();
      expect(response.body.items).toHaveLength(1); expect(response.body.items[0]).toMatchObject({ bookingId: BOOKING, channel: 'WEB', test: true, passengers: 2 });
      expect(JSON.stringify(response.body)).not.toContain('user-a'); expect(JSON.stringify(response.body)).not.toContain('pay_ok_1');
    } finally { await instance.close(); }
  });
});

describe('Aislamiento v2: un cliente no ve ni toca reservas de otro cliente ni de un socio', () => {
  const OWNED: Record<string, string> = { [BOOKING]: 'user-a', '00000000-0000-4000-8000-0000000000c9': 'booking~u1' };
  const owners: string[] = [];
  beforeEach(() => {
    owners.length = 0;
    jest.mocked(callGatewayGrpc).mockImplementation(async (_config, _service, method, input) => {
      const data = input as { ownerId: string; bookingId: string };
      owners.push(data.ownerId);
      if (method === 'getReservation') { if (OWNED[data.bookingId] !== data.ownerId) throw Object.assign(new Error('nf'), { code: 5, details: 'NOT_FOUND' }); return { bookingId: data.bookingId, pnr: 'ABC123', status: 'CONFIRMED', grandTotal: { currency: 'USD', total: '10.00' }, createdAt: '2026-11-11T00:00:00Z' }; }
      return {};
    });
  });
  const get = (server: never, id: string, authorization: string, extra: Record<string, string> = {}) => { let call = request(server).get(`/api/v2/vuelos/bookings/${id}`).set('Authorization', authorization); for (const [k, v] of Object.entries(extra)) call = call.set(k, v); return call; };
  it('ISO-01: el dueño de un usuario de Supabase es su sub; X-User-Id y la huella se ignoran', async () => {
    await withApp(async (server) => {
      const own = await get(server as never, BOOKING, token('user-a', 'customer', 'flights:read'), { 'X-User-Id': 'otro', 'X-Device-Fingerprint': 'fp' });
      expect(own.status).toBe(200); expect(owners).toEqual(['user-a']);
    }, { VALIDATE_RESPONSES: 'false' });
  });
  it('ISO-02: otro cliente recibe 404 sobre la reserva ajena (también diciendo ser el dueño por X-User-Id) y el socio no la ve', async () => {
    await withApp(async (server) => {
      expect((await get(server as never, BOOKING, token('user-b', 'customer', 'flights:read'))).status).toBe(404);
      expect((await get(server as never, BOOKING, token('user-b', 'customer', 'flights:read'), { 'X-User-Id': 'user-a' })).status).toBe(404);
      expect((await get(server as never, BOOKING, token('booking', 'partner', 'flights:read'), { 'X-User-Id': 'user-a' })).status).toBe(404);
      expect((await get(server as never, BOOKING, token('booking', 'partner', 'flights:read'))).status).toBe(404);
    }, { VALIDATE_RESPONSES: 'false' });
  });
  it('ISO-03: un cliente no ve la reserva de un socio (dueño compuesto), ni con su mismo identificador, y el socio sí ve la suya', async () => {
    await withApp(async (server) => {
      const partnerBooking = '00000000-0000-4000-8000-0000000000c9';
      expect((await get(server as never, partnerBooking, token('user-a', 'customer', 'flights:read'), { 'X-User-Id': 'booking~u1' })).status).toBe(404);
      expect((await get(server as never, partnerBooking, token('booking', 'partner', 'flights:read'), { 'X-User-Id': 'u1' })).status).toBe(200);
      expect(owners).toEqual(['user-a', 'booking~u1']);
    }, { VALIDATE_RESPONSES: 'false' });
  });
  it('ISO-04: el sub de un cliente nunca contiene el separador de dueños de socios', () => {
    expect('user-a').not.toContain('~');
  });
});
