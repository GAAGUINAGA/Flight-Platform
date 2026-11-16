import { generateKeyPairSync, randomUUID } from 'node:crypto';
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
import { openApiAdminSpecPath } from './openapi-path';
import type { InMemoryAdminAccessLog } from './admin-access-log';

jest.mock('./grpc-clients', () => ({ ...(jest.requireActual('./grpc-clients') as object), callGatewayGrpc: jest.fn(), fetchSeatMap: jest.fn() }));
import { callGatewayGrpc } from './grpc-clients';
import { createGatewayApp } from './app';

jest.setTimeout(60_000);

/** F12c-4b (check-in de la aerolínea) y F12c-4c (crear vuelos con su tarifa): puntos únicos, registro, idempotencia, orquestación. */
const BOOKING = '00000000-0000-4000-8000-0000000000c1';
const PNR = 'J4R8GZ';
const dir = mkdtempSync(join(tmpdir(), 'admin-4bc-'));
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
const pub = join(dir, 'public.pem'); writeFileSync(pub, keys.publicKey);
const env = { NODE_ENV: 'test', INTERNAL_API_KEY: 'x'.repeat(32), JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: pub }]), VALIDATE_RESPONSES: 'true', GATEWAY_TRANSPORT: 'grpc' };
const token = (sub: string, role: string, scope: string) => `Bearer ${createDevToken(keys.privateKey, { sub, app_role: role, scope })}`;
const ADMIN = token('admin-1', 'admin', 'flights:read flights:admin'); const ADMIN_2 = token('admin-2', 'admin', 'flights:read flights:admin');
const CUSTOMER = token('user-a', 'customer', 'flights:read flights:book flights:admin'); const PARTNER = token('booking', 'partner', 'flights:read flights:admin'); const ADMIN_NO_SCOPE = token('admin-3', 'admin', 'flights:read');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const spec = parse(readFileSync(openApiAdminSpecPath(), 'utf8')) as { components: { schemas: Record<string, object> } };
const ajv = new Ajv({ strict: false }); addFormats(ajv); ajv.addSchema({ ...spec, $id: 'admin' } as never);
const validate = (name: string, body: unknown) => { const check = ajv.compile({ $ref: `admin#/components/schemas/${name}` }); return { ok: check(body), errors: check.errors }; };

// ───────── gRPC simulado CON estado: lo que cada servicio haría ─────────
const checkInResult = { bookingId: BOOKING, status: 'COMPLETED', checkedInPassengers: [{ passengerId: 'p-1', status: 'CHECKED_IN', segments: [{ segmentId: 'seg-1', status: 'CHECKED_IN', seat: '12A' }], documentNumber: 'AB1234567' }], ownerId: 'clientX~user-9' };
const passes = { bookingId: BOOKING, boardingPasses: [{ passengerId: 'p-1', segmentId: 'seg-1', seat: '12A', barcode: 'M1/abc/12A', barcodeType: 'QR', cabinClass: 'ECONOMY', ownerId: 'clientX~user-9' }] };
const AIRCRAFT = [{ code: 'E190', cabins: [{ cabinClass: 'ECONOMY', seats: 99 }] }, { code: 'A320', cabins: [{ cabinClass: 'BUSINESS', seats: 12 }, { cabinClass: 'ECONOMY', seats: 150 }] }];
interface Call { service: string; method: string; input: Record<string, unknown> }
const calls: Call[] = [];
let flights: Map<string, { closed: boolean; cabins: Array<{ cabinClass: string; capacity: number }>; flightNumber: string; day: string }>;
let fares: Map<string, Array<Record<string, unknown>>>;
let failures: Record<string, unknown>; let upsertCount: number; let corruptFares: boolean;
const grpcError = (code: number, details: string) => ({ code, details, message: `${code} ${details}` });
beforeEach(() => {
  calls.length = 0; flights = new Map(); fares = new Map(); failures = {}; upsertCount = 0; corruptFares = false;
  jest.mocked(callGatewayGrpc).mockImplementation(async (_config, service, method, input) => {
    const body = input as Record<string, unknown>; calls.push({ service, method, input: body });
    if (failures[method] && method !== 'upsertFare') { const failure = failures[method]; delete failures[method]; throw failure; }
    if (method === 'adminCheckIn') return checkInResult;
    if (method === 'adminListBoardingPasses') return passes;
    if (method === 'listAircraftLayouts') return { aircraft: AIRCRAFT };
    if (method === 'createFlightInstance') {
      const id = String(body.flightInstanceId); const day = String(body.departureAt).slice(0, 10);
      if (flights.has(id)) return { flightInstanceId: id, closed: flights.get(id)!.closed };
      if ([...flights.values()].some((f) => f.flightNumber === body.flightNumber && f.day === day)) throw grpcError(6, 'FLIGHT_ALREADY_EXISTS');
      flights.set(id, { closed: true, cabins: body.cabins as never, flightNumber: String(body.flightNumber), day }); return { flightInstanceId: id, closed: true };
    }
    if (method === 'upsertFare') {
      upsertCount += 1; if (failures.upsertFare && upsertCount === Number((failures.upsertFare as { onCall?: number }).onCall)) { const error = failures.upsertFare; delete failures.upsertFare; throw (error as { error: unknown }).error; }
      const id = String(body.flightInstanceId); const list = fares.get(id) ?? [];
      list.push({ cabinClass: body.cabinClass, fareBrand: body.fareBrand, price: { ...(body.price as object), ...(corruptFares ? { total: '0.01' } : {}) }, fareRules: body.fareRules, baggageAllowance: body.baggageAllowance, extraCheckedBaggagePrice: body.extraCheckedBaggagePrice }); fares.set(id, list); return { fare: {} };
    }
    if (method === 'listFares') return { fares: (fares.get(String(body.flightInstanceId)) ?? []).map((fare) => ({ fare })), page: {} };
    if (method === 'getFlightInstance') { const flight = flights.get(String(body.flightInstanceId)); if (!flight) throw grpcError(5, 'NOT_FOUND'); return { flightInstanceId: body.flightInstanceId, cabins: flight.cabins, closed: flight.closed }; }
    if (method === 'openFlightInstance') { const flight = flights.get(String(body.flightInstanceId)); if (!flight) throw grpcError(5, 'NOT_FOUND'); flight.closed = false; return { flightInstanceId: body.flightInstanceId, closed: false }; }
    return {};
  });
});
const app = async (more: Record<string, string> = {}) => createGatewayApp(loadConfig({ ...env, ...more }));
type Instance = Awaited<ReturnType<typeof app>>;
type Server = ReturnType<Instance['getHttpServer']>;
const withApp = async (run: (server: Server, log: InMemoryAdminAccessLog, instance: Instance) => Promise<void>, more: Record<string, string> = {}) => {
  const instance = await app(more);
  try { await run(instance.getHttpServer(), instance.get('ADMIN_ACCESS_LOG') as InMemoryAdminAccessLog, instance); } finally { await instance.close(); }
};
const checkIn = (server: Server, body: unknown, key: string | null = randomUUID(), authorization = ADMIN) => { const r = request(server).post('/api/admin/v1/bookings/check-in').set('Authorization', authorization); if (key) r.set('Idempotency-Key', key); return r.send(body as object); };
const passesOf = (server: Server, body: unknown, authorization = ADMIN) => request(server).post('/api/admin/v1/bookings/boarding-passes').set('Authorization', authorization).send(body as object);

describe('F12c-4b: check-in hecho por la aerolínea (POST /api/admin/v1/bookings/check-in)', () => {
  it('ADM4-C-01: un admin hace el check-in SOLO con el PNR; el servicio recibe únicamente el PNR (sin dueño); la respuesta es una lista blanca y cumple el OpenAPI', async () => {
    await withApp(async (server, log) => {
      const response = await checkIn(server, { pnr: PNR });
      expect(response.status).toBe(200); expect(validate('AdminCheckInResult', response.body).errors).toBeNull();
      expect(calls.filter((c) => c.method === 'adminCheckIn')).toEqual([{ service: 'operations', method: 'adminCheckIn', input: { pnr: PNR } }]);
      const text = JSON.stringify(response.body); for (const forbidden of ['AB1234567', 'clientX', 'user-9', 'ownerId']) expect(text).not.toContain(forbidden);
      expect(log.rows).toHaveLength(1); expect(log.rows[0]).toMatchObject({ actorSub: 'admin-1', action: 'CHECK_IN', subject: PNR, result: 'OK', errorCode: null });
    });
  });
  it('ADM4-C-02: el cuerpo NO puede traer dueño ni bookingId: los campos de más se rechazan (404 como un PNR inexistente) y no llega nada al servicio', async () => {
    await withApp(async (server, log) => {
      for (const body of [{ pnr: PNR, ownerId: 'otro' }, { pnr: PNR, bookingId: BOOKING }, { bookingId: BOOKING }, {}, [], { pnr: 5 }]) expect((await checkIn(server, body)).status).toBe(404);
      expect(calls).toHaveLength(0); expect(log.rows.map((r) => [r.result, r.subject])).toEqual(Array(6).fill(['INVALID_FORMAT', null]));
    });
  });
  it('ADM4-C-03: matriz de roles — cliente, socio, admin sin scope y anónimo: nada llega al servicio ni al registro', async () => {
    await withApp(async (server, log) => {
      for (const [authorization, status] of [[CUSTOMER, 403], [PARTNER, 403], [ADMIN_NO_SCOPE, 403]] as const) expect((await checkIn(server, { pnr: PNR }, randomUUID(), authorization)).status).toBe(status);
      expect((await request(server).post('/api/admin/v1/bookings/check-in').set('Idempotency-Key', randomUUID()).send({ pnr: PNR })).status).toBe(401);
      expect((await passesOf(server, { pnr: PNR }, CUSTOMER)).status).toBe(403);
      expect(calls).toHaveLength(0); expect(log.rows).toHaveLength(0);
    });
  });
  it('ADM4-C-04: Idempotency-Key — sin clave o inválida ⇒ 400 registrado; la misma clave repite sin duplicar; otro cuerpo con la misma clave ⇒ 409', async () => {
    await withApp(async (server, log) => {
      expect((await checkIn(server, { pnr: PNR }, null)).status).toBe(400);
      expect((await checkIn(server, { pnr: PNR }, 'no-es-uuid')).status).toBe(400);
      expect(calls).toHaveLength(0); expect(log.rows.map((r) => [r.result, r.errorCode])).toEqual([['REJECTED', 'VALIDATION_FAILED'], ['REJECTED', 'VALIDATION_FAILED']]);
      const key = randomUUID();
      const first = await checkIn(server, { pnr: PNR }, key); const again = await checkIn(server, { pnr: PNR }, key);
      expect(first.status).toBe(200); expect(again.status).toBe(200); expect(again.headers['idempotent-replayed']).toBe('true'); expect(again.body).toEqual(first.body);
      expect(calls.filter((c) => c.method === 'adminCheckIn')).toHaveLength(1);
      const mismatch = await checkIn(server, { pnr: 'ZZZZZZ' }, key); expect(mismatch.status).toBe(409); expect(mismatch.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(log.rows.at(-1)).toMatchObject({ result: 'REJECTED', errorCode: 'IDEMPOTENCY_KEY_REUSED' });
    });
  });
  it('ADM4-C-05: las reglas del negocio llegan tal cual (ventana, estado, boletos) y se registran como REJECTED con su código; sin texto del error', async () => {
    await withApp(async (server, log) => {
      for (const [code, status] of [['CHECK_IN_NOT_AVAILABLE', 409], ['BOOKING_NOT_CONFIRMED', 409], ['FLIGHT_ALREADY_DEPARTED', 409], ['CHECK_IN_FAILED', 422]] as const) {
        failures.adminCheckIn = grpcError(9, code);
        const response = await checkIn(server, { pnr: PNR }); expect(response.status).toBe(status); expect(response.body).toMatchObject({ code });
        expect(log.rows.at(-1)).toMatchObject({ action: 'CHECK_IN', subject: PNR, result: 'REJECTED', errorCode: code });
      }
    });
  });
  it('ADM4-C-06: un PNR inexistente ⇒ 404 (NOT_FOUND registrado); un error de infraestructura ⇒ ERROR con código de la lista cerrada, sin texto hostil', async () => {
    await withApp(async (server, log) => {
      failures.adminCheckIn = grpcError(5, 'NOT_FOUND'); expect((await checkIn(server, { pnr: PNR })).status).toBe(404); expect(log.rows.at(-1)).toMatchObject({ result: 'NOT_FOUND', subject: PNR });
      failures.adminCheckIn = grpcError(13, 'Ana Pérez ana@example.com 4111111111111111'); const failed = await checkIn(server, { pnr: PNR });
      expect(failed.status).toBe(500); expect(log.rows.at(-1)).toMatchObject({ result: 'ERROR', errorCode: 'INTERNAL_ERROR' }); expect(JSON.stringify(log.rows)).not.toContain('ana@example.com');
    });
  });
  it('ADM4-C-07: límite por administrador y hora (P3): el intento siguiente ⇒ 429 registrado; otro administrador no se ve afectado', async () => {
    await withApp(async (server, log) => {
      for (let i = 0; i < 3; i += 1) expect((await checkIn(server, { pnr: PNR })).status).toBe(200);
      const limited = await checkIn(server, { pnr: PNR }); expect(limited.status).toBe(429); expect(limited.headers['retry-after']).toBeDefined(); expect(limited.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
      expect(log.rows.at(-1)).toMatchObject({ action: 'CHECK_IN', result: 'RATE_LIMITED' }); expect(calls.filter((c) => c.method === 'adminCheckIn')).toHaveLength(3);
      expect((await checkIn(server, { pnr: PNR }, randomUUID(), ADMIN_2)).status).toBe(200);
    }, { ADMIN_CHECKIN_LIMIT_PER_HOUR: '3' });
  });
  it('ADM4-C-08: si el registro no se puede escribir (falla cerrada) no se devuelve nada: 503', async () => {
    await withApp(async (server, log) => {
      jest.spyOn(log, 'record').mockRejectedValue(new Error('db down'));
      const response = await checkIn(server, { pnr: PNR }); expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain('M1/');
      const list = await passesOf(server, { pnr: PNR }); expect(list.status).toBe(503); expect(JSON.stringify(list.body)).not.toContain('M1/');
    });
  });
  it('ADM4-B-01: los pases salen en lista blanca (sin cabina ni dueño), cumplen el OpenAPI y la consulta queda registrada (BOARDING_PASSES)', async () => {
    await withApp(async (server, log) => {
      const response = await passesOf(server, { pnr: PNR });
      expect(response.status).toBe(200); expect(validate('AdminBoardingPasses', response.body).errors).toBeNull();
      expect(response.body.boardingPasses).toEqual([{ passengerId: 'p-1', segmentId: 'seg-1', seat: '12A', barcode: 'M1/abc/12A', barcodeType: 'QR' }]);
      expect(JSON.stringify(response.body)).not.toContain('clientX');
      expect(calls[0]).toEqual({ service: 'operations', method: 'adminListBoardingPasses', input: { pnr: PNR } });
      expect(log.rows[0]).toMatchObject({ action: 'BOARDING_PASSES', subject: PNR, result: 'OK' });
      expect((await passesOf(server, { pnr: 'zz' })).status).toBe(404); expect(log.rows.at(-1)).toMatchObject({ result: 'INVALID_FORMAT', subject: null });
    });
  });
});

// ───────── 4c ─────────
const futureDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const fare = (cabinClass: string, fareBrand: string, extra: Record<string, unknown> = {}) => ({ cabinClass, fareBrand, baseFare: '80.00', taxes: '20.00', isRefundable: false, isChangeable: true, carryOnIncluded: 1, checkedBaggageIncluded: 0, extraBaggagePrice: '35.00', ...extra });
const flightBody = (extra: Record<string, unknown> = {}) => ({ flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureLocal: `${futureDay(10)}T15:00`, durationMinutes: 120, aircraft: 'E190', fares: [fare('ECONOMY', 'Basic'), fare('ECONOMY', 'Flex', { baseFare: '120.00', isRefundable: true })], ...extra });
const createFlight = (server: Server, body: unknown, key: string | null = randomUUID(), authorization = ADMIN) => { const r = request(server).post('/api/admin/v1/flights').set('Authorization', authorization); if (key) r.set('Idempotency-Key', key); return r.send(body as object); };
const openFlight = (server: Server, id: string, key: string | null = randomUUID(), authorization = ADMIN) => { const r = request(server).post(`/api/admin/v1/flights/${id}/open`).set('Authorization', authorization); if (key) r.set('Idempotency-Key', key); return r.send(); };
const writes = () => calls.filter((c) => ['createFlightInstance', 'upsertFare', 'openFlightInstance'].includes(c.method)).map((c) => c.method);

describe('F12c-4c: crear vuelos con su tarifa (POST /api/admin/v1/flights)', () => {
  it('ADM4-F-01: crea CERRADO → guarda las tarifas → las relee → NO abre si no se pidió; la hora local se convierte a UTC y la llegada se calcula', async () => {
    await withApp(async (server, log) => {
      const response = await createFlight(server, flightBody());
      expect(response.status).toBe(201); expect(validate('AdminCreatedFlight', response.body).errors).toBeNull();
      expect(response.body).toMatchObject({ flightNumber: 'FP210', status: 'CLOSED', closed: true, aircraft: 'E190', origin: 'UIO', destination: 'GPS', durationMinutes: 120, departureLocal: `${futureDay(10)}T15:00`, cabins: [{ cabinClass: 'ECONOMY', capacity: 99 }] });
      // UIO es UTC-5 y GPS es UTC-6: 15:00 locales de salida = 20:00Z; llegada 22:00Z = 16:00 locales de Galápagos.
      expect(response.body.departureAt).toBe(`${futureDay(10)}T20:00:00.000Z`); expect(response.body.arrivalAt).toBe(`${futureDay(10)}T22:00:00.000Z`);
      expect(response.body.departureLocal).toBe(`${futureDay(10)}T15:00`); expect(response.body.arrivalLocal).toBe(`${futureDay(10)}T16:00`);
      expect(calls.map((c) => c.method)).toEqual(['listAircraftLayouts', 'createFlightInstance', 'upsertFare', 'upsertFare', 'listFares']);
      expect(calls[1].input).toMatchObject({ flightNumber: 'FP210', departureIata: 'UIO', arrivalIata: 'GPS', aircraft: 'E190', cabins: [{ cabinClass: 'ECONOMY', capacity: 99 }] });
      expect(log.rows).toHaveLength(1); expect(log.rows[0]).toMatchObject({ actorSub: 'admin-1', action: 'CREATE_FLIGHT', subject: 'FP210', result: 'OK' });
      expect(JSON.stringify(log.rows)).not.toContain('80.00');
    });
  });
  it('ADM4-F-02: con openForSale se abre SOLO al final y solo después de releer y comprobar las tarifas', async () => {
    await withApp(async (server) => {
      const response = await createFlight(server, flightBody({ openForSale: true }));
      expect(response.status).toBe(201); expect(response.body).toMatchObject({ status: 'OPEN', closed: false });
      // La apertura automática pasa por la MISMA comprobación que la manual: relee la instancia y las tarifas justo antes de abrir.
      expect(calls.map((c) => c.method)).toEqual(['listAircraftLayouts', 'createFlightInstance', 'upsertFare', 'upsertFare', 'listFares', 'getFlightInstance', 'listFares', 'openFlightInstance']);
    });
  });
  it('ADM4-F-03: el avión define las cabinas y capacidades (A320: dos cabinas); falta una tarifa por cabina ⇒ 400 sin escribir nada', async () => {
    await withApp(async (server) => {
      const bad = await createFlight(server, flightBody({ aircraft: 'A320' })); expect(bad.status).toBe(400);
      expect(bad.body.invalidParams).toEqual([{ name: 'fares', reason: 'missing-fare-BUSINESS' }]); expect(writes()).toEqual([]);
      const ok = await createFlight(server, flightBody({ aircraft: 'A320', fares: [fare('BUSINESS', 'Premium', { baseFare: '300.00' }), fare('ECONOMY', 'Basic')] }));
      expect(ok.status).toBe(201); expect(ok.body.cabins).toEqual([{ cabinClass: 'BUSINESS', capacity: 12 }, { cabinClass: 'ECONOMY', capacity: 150 }]);
    });
  });
  it.each([
    ['prefijo de otra aerolínea', { flightNumber: 'AA210' }, 'flightNumber', 'airline-prefix'],
    ['número con letras', { flightNumber: 'FP21A' }, 'flightNumber', 'invalid'],
    ['aeropuerto desconocido', { destination: 'XXX' }, 'destination', 'airport-unknown'],
    ['origen igual al destino', { destination: 'UIO' }, 'destination', 'same-as-origin'],
    ['salida en menos de 60 min', { departureLocal: new Date(Date.now() + 30 * 60_000 - 5 * 3_600_000).toISOString().slice(0, 16) }, 'departureLocal', 'too-soon'],
    ['salida a más de 400 días', { departureLocal: `${futureDay(420)}T10:00` }, 'departureLocal', 'too-far'],
    ['duración menor de 20 min', { durationMinutes: 19 }, 'durationMinutes', 'duration-out-of-range'],
    ['duración mayor de 20 h', { durationMinutes: 1201 }, 'durationMinutes', 'duration-out-of-range'],
    ['avión fuera del catálogo', { aircraft: 'B777' }, 'aircraft', 'aircraft-not-supported'],
    ['fecha inexistente', { departureLocal: `${futureDay(10).slice(0, 8)}32T10:00` }, 'departureLocal', 'invalid'],
    ['hora con desplazamiento', { departureLocal: `${futureDay(10)}T10:00:00Z` }, 'departureLocal', 'invalid'],
    ['campo de más', { extra: 1 }, 'extra', 'invalid']
  ])('ADM4-F-04: %s ⇒ 400 con el campo y SIN valores; no se escribe nada y queda registrado como REJECTED', async (_name, change, field, reason) => {
    await withApp(async (server, log) => {
      const response = await createFlight(server, flightBody(change));
      expect(response.status).toBe(400); expect(response.body.invalidParams).toEqual(expect.arrayContaining([{ name: field, reason }]));
      expect(writes()).toEqual([]); expect(log.rows.at(-1)).toMatchObject({ action: 'CREATE_FLIGHT', result: 'REJECTED', errorCode: 'VALIDATION_FAILED' });
      expect(JSON.stringify(response.body)).not.toContain('XXX'); expect(JSON.stringify(response.body)).not.toContain('B777');
    });
  });
  it('ADM4-F-05: validaciones de tarifa — moneda distinta de USD, marca repetida, cabina fuera del avión, total 0 ⇒ 400 sin escribir', async () => {
    await withApp(async (server) => {
      for (const [fares, name, reason] of [
        [[fare('ECONOMY', 'Basic', { currency: 'EUR' })], 'fares.0.currency', 'currency-not-allowed'],
        [[fare('ECONOMY', 'Basic'), fare('ECONOMY', 'basic')], 'fares.1.fareBrand', 'duplicate-brand'],
        [[fare('BUSINESS', 'Basic'), fare('ECONOMY', 'Basic')], 'fares.0.cabinClass', 'cabin-not-in-aircraft'],
        [[fare('ECONOMY', 'Basic', { baseFare: '0.00', taxes: '0.00' })], 'fares.0.baseFare', 'total-not-positive'],
        [[fare('ECONOMY', 'Basic', { baseFare: '10' })], 'fares.0.baseFare', 'invalid']
      ] as const) {
        const response = await createFlight(server, flightBody({ fares })); expect(response.status).toBe(400);
        expect(response.body.invalidParams).toEqual(expect.arrayContaining([{ name, reason }]));
      }
      expect(writes()).toEqual([]);
    });
  });
  it('ADM4-F-06: horas locales INEXISTENTES o AMBIGUAS se rechazan (Madrid, cambio de horario) y no se elige una en silencio', async () => {
    await withApp(async (server) => {
      const year = new Date().getUTCFullYear() + 1;
      // Último domingo de marzo/octubre del año próximo en Madrid.
      const lastSunday = (month: number) => { const d = new Date(Date.UTC(year, month + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
      for (const [day, hour, reason] of [[lastSunday(2), '02:30', 'local-time-nonexistent'], [lastSunday(9), '02:30', 'local-time-ambiguous']] as const) {
        const response = await createFlight(server, flightBody({ origin: 'MAD', destination: 'UIO', departureLocal: `${day}T${hour}`, durationMinutes: 600 }));
        expect(response.status).toBe(400); expect(response.body.invalidParams).toEqual([{ name: 'departureLocal', reason }]);
      }
      expect(writes()).toEqual([]);
    }, { ADMIN_FLIGHT_MAX_DAYS_AHEAD: '800' });
  });
  it('ADM4-F-07: doble clic — la misma Idempotency-Key y el mismo cuerpo crean UN vuelo; con otro cuerpo ⇒ 409; sin clave ⇒ 400 registrado', async () => {
    await withApp(async (server, log) => {
      const key = randomUUID();
      const first = await createFlight(server, flightBody(), key); const second = await createFlight(server, flightBody(), key);
      expect(first.status).toBe(201); expect(second.status).toBe(200); expect(second.headers['idempotent-replayed']).toBe('true'); expect(second.body).toEqual(first.body);
      expect(writes().filter((m) => m === 'createFlightInstance')).toHaveLength(1); expect(flights.size).toBe(1);
      expect((await createFlight(server, flightBody({ durationMinutes: 130 }), key)).body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect((await createFlight(server, flightBody(), null)).status).toBe(400); expect(log.rows.at(-1)).toMatchObject({ result: 'REJECTED', errorCode: 'VALIDATION_FAILED' });
    });
  });
  it('ADM4-F-08: duplicado (mismo número, mismo día local) con OTRA clave ⇒ 409 FLIGHT_ALREADY_EXISTS y no se guardan tarifas', async () => {
    await withApp(async (server, log) => {
      expect((await createFlight(server, flightBody())).status).toBe(201); const before = writes().length;
      const duplicate = await createFlight(server, flightBody()); expect(duplicate.status).toBe(409); expect(duplicate.body).toMatchObject({ code: 'FLIGHT_ALREADY_EXISTS' });
      expect(writes().slice(before)).toEqual(['createFlightInstance']); expect(log.rows.at(-1)).toMatchObject({ result: 'REJECTED', errorCode: 'FLIGHT_ALREADY_EXISTS', subject: 'FP210' });
    });
  });
  it('ADM4-F-09: ATOMICIDAD — un fallo al guardar la 2.ª tarifa deja el vuelo CERRADO (nunca abierto), responde 503 con el id y reintentar con la MISMA clave lo completa', async () => {
    await withApp(async (server, log) => {
      const key = randomUUID(); failures.upsertFare = { onCall: 2, error: grpcError(14, 'UNAVAILABLE') };
      const failed = await createFlight(server, flightBody({ openForSale: true }), key);
      expect(failed.status).toBe(503); expect(failed.body.detail).toMatch(/CERRADO e incompleto/);
      const [id] = [...flights.keys()]; expect(failed.body.detail).toContain(id); expect(flights.get(id)!.closed).toBe(true); expect(writes()).not.toContain('openFlightInstance');
      expect(log.rows.at(-1)).toMatchObject({ action: 'CREATE_FLIGHT', result: 'ERROR', errorCode: 'PROVIDER_UNAVAILABLE' });
      const retry = await createFlight(server, flightBody({ openForSale: true }), key);
      expect(retry.status).toBe(201); expect(retry.body.flightInstanceId).toBe(id); expect(flights.size).toBe(1); expect(flights.get(id)!.closed).toBe(false);
      expect(fares.get(id)!.filter((f) => f.fareBrand === 'Basic').length).toBeGreaterThanOrEqual(1);
    });
  });
  it('ADM4-F-10: las tarifas se RELEEN: si lo guardado no coincide con lo enviado, NO se abre y queda cerrado e incompleto', async () => {
    await withApp(async (server) => {
      corruptFares = true; const response = await createFlight(server, flightBody({ openForSale: true }));
      expect(response.status).toBe(503); expect(response.body.detail).toMatch(/no coinciden/); expect(writes()).not.toContain('openFlightInstance'); expect([...flights.values()][0].closed).toBe(true);
    });
  });
  it('ADM4-F-11: matriz de roles — cliente, socio, admin sin scope y anónimo no crean, no abren y no ven el catálogo (nada llega a los servicios ni al registro)', async () => {
    await withApp(async (server, log) => {
      for (const authorization of [CUSTOMER, PARTNER, ADMIN_NO_SCOPE]) {
        expect((await createFlight(server, flightBody(), randomUUID(), authorization)).status).toBe(403);
        expect((await openFlight(server, randomUUID(), randomUUID(), authorization)).status).toBe(403);
        expect((await request(server).get('/api/admin/v1/aircraft').set('Authorization', authorization)).status).toBe(403);
      }
      expect((await request(server).post('/api/admin/v1/flights').set('Idempotency-Key', randomUUID()).send(flightBody())).status).toBe(401);
      expect(calls).toHaveLength(0); expect(log.rows).toHaveLength(0);
    });
  });
  it('ADM4-F-12: el catálogo de aviones se lee con rol admin y cumple el OpenAPI', async () => {
    await withApp(async (server) => {
      const response = await request(server).get('/api/admin/v1/aircraft').set('Authorization', ADMIN);
      expect(response.status).toBe(200); expect(validate('AdminAircraftCatalog', response.body).errors).toBeNull(); expect(response.body.aircraft.map((a: { code: string }) => a.code)).toEqual(['E190', 'A320']);
    });
  });
  it('ADM4-F-13: sin catálogo (Ancillaries caído) no se crea nada: 503 y el vuelo no existe', async () => {
    await withApp(async (server) => {
      failures.listAircraftLayouts = grpcError(14, 'UNAVAILABLE'); const response = await createFlight(server, flightBody());
      expect(response.status).toBe(503); expect(writes()).toEqual([]); expect(flights.size).toBe(0);
    });
  });
  it('ADM4-F-14: el sujeto del registro es SOLO un número de vuelo válido: un texto hostil en flightNumber queda como sujeto nulo', async () => {
    await withApp(async (server, log) => {
      const response = await createFlight(server, flightBody({ flightNumber: 'Ana Pérez ana@example.com' })); expect(response.status).toBe(400);
      expect(log.rows.at(-1)).toMatchObject({ action: 'CREATE_FLIGHT', subject: null, result: 'REJECTED' }); expect(JSON.stringify(log.rows)).not.toContain('ana@example.com');
    });
  });
  it('ADM4-F-15: un cuerpo ilegible o de más de 16 kB responde como cuerpo inválido (400 registrado), no antes de la autenticación', async () => {
    await withApp(async (server, log) => {
      const unreadable = await request(server).post('/api/admin/v1/flights').set('Authorization', ADMIN).set('Idempotency-Key', randomUUID()).set('Content-Type', 'application/json').send('{no json');
      expect(unreadable.status).toBe(400); expect(log.rows.at(-1)).toMatchObject({ action: 'CREATE_FLIGHT', result: 'REJECTED' });
      const anonymous = await request(server).post('/api/admin/v1/flights').set('Content-Type', 'application/json').send('{no json'); expect(anonymous.status).toBe(401);
    });
  });
});

describe('F12c-4c: abrir a la venta (POST /api/admin/v1/flights/{id}/open)', () => {
  it('ADM4-O-01: abre un vuelo cerrado con todas sus tarifas; idempotente; queda registrado (OPEN_FLIGHT con el id)', async () => {
    await withApp(async (server, log) => {
      const created = await createFlight(server, flightBody()); const id = created.body.flightInstanceId as string; const key = randomUUID();
      const opened = await openFlight(server, id, key);
      expect(opened.status).toBe(200); expect(validate('AdminOpenedFlight', opened.body).errors).toBeNull(); expect(flights.get(id)!.closed).toBe(false);
      expect((await openFlight(server, id, key)).headers['idempotent-replayed']).toBe('true');
      expect(log.rows.at(-1)).toMatchObject({ action: 'OPEN_FLIGHT', subject: id, result: 'OK' });
    });
  });
  it('ADM4-O-02: NO abre un vuelo con una cabina sin tarifa (releída en el momento de abrir): 409 FLIGHT_NOT_READY y el vuelo sigue cerrado', async () => {
    await withApp(async (server, log) => {
      const created = await createFlight(server, flightBody()); const id = created.body.flightInstanceId as string; fares.set(id, []);
      const response = await openFlight(server, id); expect(response.status).toBe(409); expect(response.body).toMatchObject({ code: 'FLIGHT_NOT_READY' });
      expect(flights.get(id)!.closed).toBe(true); expect(writes().filter((m) => m === 'openFlightInstance')).toHaveLength(0);
      expect(log.rows.at(-1)).toMatchObject({ action: 'OPEN_FLIGHT', result: 'REJECTED', errorCode: 'FLIGHT_NOT_READY' });
    });
  });
  it('ADM4-O-04: una tarifa INVÁLIDA releída (total que no cuadra, moneda ≠ USD) no cuenta: 409 FLIGHT_NOT_READY con la cabina que falta (sin texto libre) y el vuelo sigue cerrado', async () => {
    await withApp(async (server, log) => {
      const created = await createFlight(server, flightBody()); const id = created.body.flightInstanceId as string;
      for (const bad of [{ total: '1.00' }, { currency: 'EUR' }]) {
        fares.set(id, fares.get(id)!.map((f) => ({ ...f, price: { ...(f.price as object), ...bad } })));
        const response = await openFlight(server, id); expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'FLIGHT_NOT_READY', invalidParams: [{ name: 'fares', reason: 'missing-fare-ECONOMY' }] });
        expect(flights.get(id)!.closed).toBe(true); expect(log.rows.at(-1)).toMatchObject({ action: 'OPEN_FLIGHT', result: 'REJECTED', errorCode: 'FLIGHT_NOT_READY' });
      }
      expect(writes().filter((m) => m === 'openFlightInstance')).toHaveLength(0);
    });
  });
  it('ADM4-O-05: el escenario de audit-42 — al crear falla el guardado de la tarifa de una cabina ⇒ cerrado; "Abrir a la venta" se RECHAZA y queda en el registro; se completa la tarifa ⇒ ahora sí abre', async () => {
    await withApp(async (server, log) => {
      const key = randomUUID(); const body = flightBody({ aircraft: 'A320', fares: [fare('ECONOMY', 'Basic'), fare('BUSINESS', 'Premium', { baseFare: '300.00' })] });
      failures.upsertFare = { onCall: 2, error: grpcError(14, 'UNAVAILABLE') };
      const failed = await createFlight(server, body, key); expect(failed.status).toBe(503);
      const [id] = [...flights.keys()]; expect(flights.get(id)!.closed).toBe(true);
      const rejected = await openFlight(server, id); expect(rejected.status).toBe(409);
      expect(rejected.body).toMatchObject({ code: 'FLIGHT_NOT_READY', invalidParams: [{ name: 'fares', reason: 'missing-fare-BUSINESS' }] });
      expect(flights.get(id)!.closed).toBe(true); expect(log.rows.at(-1)).toMatchObject({ action: 'OPEN_FLIGHT', subject: id, result: 'REJECTED', errorCode: 'FLIGHT_NOT_READY' });
      expect((await createFlight(server, body, key)).status).toBe(201); // misma clave: completa las tarifas (el vuelo sigue cerrado)
      expect(flights.get(id)!.closed).toBe(true);
      const opened = await openFlight(server, id); expect(opened.status).toBe(200); expect(flights.get(id)!.closed).toBe(false);
      expect(log.rows.at(-1)).toMatchObject({ action: 'OPEN_FLIGHT', result: 'OK' });
    });
  });
  it('ADM4-O-06: la apertura automática al crear usa la misma comprobación: si al releer una cabina no tiene tarifa válida ⇒ 409 FLIGHT_NOT_READY y el vuelo queda cerrado', async () => {
    await withApp(async (server) => {
      const original = jest.mocked(callGatewayGrpc).getMockImplementation()!; let listCalls = 0;
      jest.mocked(callGatewayGrpc).mockImplementation(async (config, service, method, input, ...rest) => {
        if (method === 'listFares' && ++listCalls === 2) return { fares: [], page: {} }; // la relectura previa a abrir (la primera es la verificación posterior al guardado)
        return original(config, service, method, input, ...rest);
      });
      const response = await createFlight(server, flightBody({ openForSale: true }));
      expect(response.status).toBe(409); expect(response.body).toMatchObject({ code: 'FLIGHT_NOT_READY' });
      expect([...flights.values()][0].closed).toBe(true); expect(writes()).not.toContain('openFlightInstance');
    });
  });
  it('ADM4-O-03: un vuelo inexistente ⇒ 404; un id que no es UUID ⇒ 400 y sujeto nulo; sin Idempotency-Key ⇒ 400', async () => {
    await withApp(async (server, log) => {
      expect((await openFlight(server, randomUUID())).status).toBe(404); expect(log.rows.at(-1)).toMatchObject({ result: 'NOT_FOUND' });
      expect((await openFlight(server, 'no-uuid')).status).toBe(400); expect(log.rows.at(-1)).toMatchObject({ result: 'REJECTED', subject: null });
      expect((await openFlight(server, randomUUID(), null)).status).toBe(400);
    });
  });
});
