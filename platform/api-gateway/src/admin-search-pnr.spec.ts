import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import express from 'express';
import request from 'supertest';
import { parse } from 'yaml';
import { createDevToken } from '../../../infra/scripts/dev-token';
import { loadConfig } from './config';
import { mountAdminApiHttp } from './admin-api';
import { openApiAdminSpecPath } from './openapi-path';
import type { InMemoryAdminAccessLog } from './admin-access-log';

jest.mock('./grpc-clients', () => ({ ...(jest.requireActual('./grpc-clients') as object), callGatewayGrpc: jest.fn(), fetchSeatMap: jest.fn() }));
import { callGatewayGrpc } from './grpc-clients';
import { createGatewayApp } from './app';

jest.setTimeout(60_000);

/** F12c-4a (ADR-F12c4-01): búsqueda de una reserva por PNR, solo lectura, con registro de cada intento. */
const BOOKING = '00000000-0000-4000-8000-0000000000c1';
const PNR = 'J4R8GZ';
const dir = mkdtempSync(join(tmpdir(), 'admin-pnr-'));
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

/** Lo que Reservation devolvería, MÁS campos que jamás deben salir (el Gateway repite la lista blanca). */
const reservationView = {
  bookingId: BOOKING, pnr: PNR, status: 'CONFIRMED', channel: 'PARTNER', partnerRef: 'a1b2c3d4e5f6', createdAt: '2026-11-14T10:00:00.000Z', grandTotal: { currency: 'USD', total: '210.00' },
  segments: [{ segmentId: 'seg-1', flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureAt: '2026-11-15T15:00:00.000Z', arrivalAt: '2026-11-15T17:00:00.000Z', departureLocal: '2026-11-15T10:00', arrivalLocal: '2026-11-15T11:00', status: 'SCHEDULED', cabinClass: 'ECONOMY' }],
  passengers: [{ passengerId: 'p-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Pérez', seats: [{ segmentId: 'seg-1', seatNumber: '12A', status: 'TICKETED' }], extraBaggage: [{ itineraryId: 'it-1', quantity: 1 }], documentNumber: 'AB1234567', contact: { email: 'ana@example.com', phone: '+593990000000' }, birthDate: '1990-01-01' }],
  tickets: [{ passengerId: 'p-1', status: 'ISSUED', eTicketLast4: '7890', eTicketNumber: '1234567890', segments: [{ segmentId: 'seg-1', status: 'ISSUED' }] }],
  ownerId: 'clientX~user-9', paymentReference: 'pay_secret_1', clientId: 'booking-client-id'
};
const checkInStatus = { bookingId: BOOKING, status: 'COMPLETED', passengers: [{ passengerId: 'p-1', status: 'CHECKED_IN', segments: [{ segmentId: 'seg-1', status: 'CHECKED_IN', seat: '12A' }] }] };
const FORBIDDEN_TEXT = ['AB1234567', 'ana@example.com', '+593990000000', '1990-01-01', 'pay_secret_1', 'clientX', 'user-9', 'booking-client-id', '1234567890'];

const calls: Array<{ service: string; method: string; input: Record<string, unknown> }> = [];
let reservationFailure: unknown; let operationsFailure: unknown;
const app = async (more: Record<string, string> = {}) => createGatewayApp(loadConfig({ ...env, ...more }));
beforeEach(() => {
  calls.length = 0; reservationFailure = undefined; operationsFailure = undefined;
  jest.mocked(callGatewayGrpc).mockImplementation(async (_config, service, method, input) => {
    calls.push({ service, method, input: input as Record<string, unknown> });
    if (method === 'adminGetReservationByPnr') { if (reservationFailure) throw reservationFailure; return reservationView; }
    if (method === 'adminGetCheckInStatus') { if (operationsFailure) throw operationsFailure; return checkInStatus; }
    return {};
  });
});
type Instance = Awaited<ReturnType<typeof app>>;
const withApp = async (run: (server: ReturnType<Instance['getHttpServer']>, log: InMemoryAdminAccessLog, instance: Instance) => Promise<void>, more: Record<string, string> = {}) => {
  const instance = await app(more);
  try { await run(instance.getHttpServer(), instance.get('ADMIN_ACCESS_LOG') as InMemoryAdminAccessLog, instance); } finally { await instance.close(); }
};
const search = (server: ReturnType<Instance['getHttpServer']>, pnr: unknown, authorization = ADMIN) => request(server).post('/api/admin/v1/bookings/search').set('Authorization', authorization).send({ pnr });
/** Un problema sin lo que cambia en cada respuesta (marca de tiempo, correlación). */
const shape = (body: Record<string, unknown>) => { const { timestamp, correlation_id: correlation, instance, ...rest } = body; void timestamp; void correlation; void instance; return rest; };

describe('F12c-4a: buscar una reserva por PNR (POST /api/admin/v1/bookings/search)', () => {
  it('ADM4-P-01: un admin encuentra la reserva; la respuesta cumple el OpenAPI interno y se compone de Reservation y Operations', async () => {
    await withApp(async (server) => {
      const response = await search(server, PNR);
      expect(response.status).toBe(200); expect(validate('AdminBookingView', response.body).errors).toBeNull();
      expect(response.body).toMatchObject({ bookingId: BOOKING, pnr: PNR, channel: 'PARTNER', checkIn: { status: 'COMPLETED' } });
      expect(response.body.passengers[0]).toMatchObject({ firstName: 'Ana', lastName: 'Pérez' }); expect(response.body.segments[0]).toMatchObject({ departureLocal: '2026-11-15T10:00', arrivalLocal: '2026-11-15T11:00' });
      expect(calls).toEqual([{ service: 'reservation', method: 'adminGetReservationByPnr', input: { pnr: PNR } }, { service: 'operations', method: 'adminGetCheckInStatus', input: { bookingId: BOOKING } }]);
    });
  });
  it('ADM4-P-02: la respuesta NO contiene documento, correo, teléfono, nacimiento, referencia de pago, dueño ni el id del socio (aunque el servicio los enviara)', async () => {
    await withApp(async (server) => {
      const response = await search(server, PNR); const text = JSON.stringify(response.body);
      for (const forbidden of FORBIDDEN_TEXT) expect(text).not.toContain(forbidden);
      for (const key of ['documentNumber', 'contact', 'email', 'phone', 'birthDate', 'paymentReference', 'ownerId', 'clientId', 'eTicketNumber']) expect(text).not.toContain(`"${key}"`);
      expect(response.body.partnerRef).toBe('a1b2c3d4e5f6'); expect(response.body.tickets[0].eTicketLast4).toBe('7890');
    });
  });
  it('ADM4-P-03: el canal WEB no lleva partnerRef', async () => {
    await withApp(async (server) => {
      jest.mocked(callGatewayGrpc).mockImplementation(async (_c, _s, method) => method === 'adminGetReservationByPnr' ? { ...reservationView, channel: 'WEB', partnerRef: 'zzz' } : checkInStatus);
      const response = await search(server, PNR);
      expect(response.status).toBe(200); expect(response.body.channel).toBe('WEB'); expect(response.body).not.toHaveProperty('partnerRef');
    });
  });
  it('ADM4-P-04: un PNR en minúsculas o con espacios se normaliza', async () => {
    await withApp(async (server, log) => {
      const response = await search(server, ' j4r8gz ');
      expect(response.status).toBe(200); expect(calls[0].input).toEqual({ pnr: PNR }); expect(log.rows[0]).toMatchObject({ subject: PNR, result: 'FOUND' });
    });
  });
  it('ADM4-P-05: inexistente, formato inválido y reserva «ajena» responden EXACTAMENTE lo mismo: 404 NOT_FOUND', async () => {
    await withApp(async (server) => {
      reservationFailure = { code: 5, details: 'NOT_FOUND' };
      const missing = await search(server, 'ZZZZZZ');
      const invalid = [await search(server, 'ABC'), await search(server, 'J4R8G0'), await search(server, 'J4R8GZZ'), await search(server, 'ÑÑÑÑÑÑ'), await search(server, '<script>')];
      expect(missing.status).toBe(404); expect(validate('ProblemDetails', missing.body).errors).toBeNull(); expect(missing.body.code).toBe('NOT_FOUND');
      for (const response of invalid) { expect(response.status).toBe(404); expect(shape(response.body)).toEqual(shape(missing.body)); }
    });
  });
  it('ADM4-P-06: un formato inválido no llega a los servicios', async () => {
    await withApp(async (server) => {
      await search(server, 'J4R8G0'); await search(server, 'AB'); expect(calls).toHaveLength(0);
    });
  });
  it('ADM4-P-07: cada intento queda registrado (quién, qué PNR, resultado) sin datos de la reserva; un formato inválido no guarda el texto', async () => {
    await withApp(async (server, log) => {
      await search(server, PNR); reservationFailure = { code: 5 }; await search(server, 'ZZZZZZ'); await search(server, 'texto pegado por error');
      expect(log.rows.map((row) => ({ actorSub: row.actorSub, action: row.action, subject: row.subject, result: row.result }))).toEqual([
        { actorSub: 'admin-1', action: 'SEARCH_PNR', subject: PNR, result: 'FOUND' },
        { actorSub: 'admin-1', action: 'SEARCH_PNR', subject: 'ZZZZZZ', result: 'NOT_FOUND' },
        { actorSub: 'admin-1', action: 'SEARCH_PNR', subject: null, result: 'INVALID_FORMAT' }
      ]);
      const text = JSON.stringify(log.rows); for (const forbidden of [...FORBIDDEN_TEXT, 'Ana', 'Pérez', 'texto pegado']) expect(text).not.toContain(forbidden);
      expect(log.rows.every((row) => row.correlationId)).toBe(true);
    });
  });
  it.each([['customer con flights:admin', CUSTOMER], ['partner con flights:admin', PARTNER], ['admin sin flights:admin', ADMIN_NO_SCOPE]])('ADM4-P-08: %s ⇒ 403 antes de validar el cuerpo, sin llamar a servicios ni registrar', async (_name, authorization) => {
    await withApp(async (server, log) => {
      for (const body of [{ pnr: PNR }, { campo: 1 }, {}]) {
        const response = await request(server).post('/api/admin/v1/bookings/search').set('Authorization', authorization).send(body);
        expect(response.status).toBe(403); expect(response.body.code).toBe('FORBIDDEN');
      }
      expect(calls).toHaveLength(0); expect(log.rows).toHaveLength(0);
    });
  });
  it('ADM4-P-09: sin token ⇒ 401', async () => {
    await withApp(async (server) => { const response = await request(server).post('/api/admin/v1/bookings/search').send({ pnr: PNR }); expect(response.status).toBe(401); expect(calls).toHaveLength(0); });
  });
  const postRaw = (server: ReturnType<Instance['getHttpServer']>, body: string | undefined, contentType = 'application/json') => { const r = request(server).post('/api/admin/v1/bookings/search').set('Authorization', ADMIN); return (body === undefined ? r : r.set('Content-Type', contentType).send(body)); };
  it.each([
    ['sin cuerpo', undefined, 'application/json'], ['JSON ilegible', '{"pnr":', 'application/json'], ['JSON demasiado grande', JSON.stringify({ pnr: 'x'.repeat(40_000) }), 'application/json'], ['texto plano', 'J4R8GZ', 'text/plain'],
    ['null', 'null', 'application/json'], ['una cadena', '"J4R8GZ"', 'application/json'], ['un número', '5', 'application/json'], ['un arreglo', '["J4R8GZ"]', 'application/json'],
    ['objeto vacío', '{}', 'application/json'], ['pnr numérico', '{"pnr":5}', 'application/json'], ['pnr nulo', '{"pnr":null}', 'application/json'], ['pnr objeto', '{"pnr":{"a":1}}', 'application/json'], ['pnr arreglo', '{"pnr":["J4R8GZ"]}', 'application/json'],
    ['pnr vacío', '{"pnr":""}', 'application/json'], ['campo de más', '{"pnr":"J4R8GZ","extra":1}', 'application/json'], ['otro campo', '{"localizador":"J4R8GZ"}', 'application/json']
  ] as Array<[string, string | undefined, string]>)('ADM4-P-10: cuerpo inválido (%s) ⇒ 404 idéntico y exactamente UNA fila INVALID_FORMAT sin sujeto, escrita antes de responder', async (_name, body, contentType) => {
    await withApp(async (server, log) => {
      const missing = await search(server, 'J4R8G0'); log.rows.length = 0;
      let rowsWhenResponding = -1; const original = log.record.bind(log); let recorded = 0; log.record = async (entry) => { await original(entry); recorded = log.rows.length; };
      const response = await postRaw(server, body, contentType); rowsWhenResponding = recorded;
      expect(response.status).toBe(404); expect(response.body.code).toBe('NOT_FOUND'); expect(shape(response.body)).toEqual(shape(missing.body));
      expect(rowsWhenResponding).toBe(1); expect(log.rows).toHaveLength(1); expect(log.rows[0]).toMatchObject({ actorSub: 'admin-1', action: 'SEARCH_PNR', subject: null, result: 'INVALID_FORMAT', errorCode: null }); expect(calls).toHaveLength(0);
    });
  });
  it('ADM4-P-10b: un texto vacío, de espacios o enorme NO es un 400: es un intento mal formado, responde 404 y queda registrado sin su texto', async () => {
    await withApp(async (server, log) => {
      for (const pnr of ['', '   ', 'x'.repeat(5000)]) { const response = await search(server, pnr); expect(response.status).toBe(404); expect(response.body.code).toBe('NOT_FOUND'); }
      expect(calls).toHaveLength(0); expect(log.rows.map((row) => [row.result, row.subject])).toEqual([['INVALID_FORMAT', null], ['INVALID_FORMAT', null], ['INVALID_FORMAT', null]]);
    });
  });
  it('ADM4-P-11: el límite por administrador y hora (3) responde 429 con Retry-After; otro administrador no se ve afectado y el bloqueo no se prolonga', async () => {
    await withApp(async (server, log) => {
      for (let index = 0; index < 3; index += 1) expect((await search(server, PNR)).status).toBe(200);
      const limited = await search(server, PNR);
      expect(limited.status).toBe(429); expect(limited.body.code).toBe('RATE_LIMIT_EXCEEDED'); expect(limited.body.type).toContain('admin-pnr-search-limit'); expect(limited.headers['retry-after']).toBe('60'); expect(validate('ProblemDetails', limited.body).errors).toBeNull();
      expect((await search(server, PNR, ADMIN_2)).status).toBe(200);
      await search(server, PNR); await search(server, PNR);
      expect(log.rows.filter((row) => row.actorSub === 'admin-1' && row.result === 'RATE_LIMITED')).toHaveLength(3);
      // Los intentos rechazados por el límite no cuentan: pasada la hora, vuelve a funcionar.
      expect(await log.countSince('admin-1', 'SEARCH_PNR', new Date(0))).toBe(3);
      const rows = log.rows; const old = new Date(Date.now() - 3_700_000); for (const row of rows) row.at = old;
      expect((await search(server, PNR)).status).toBe(200);
    }, { ADMIN_PNR_SEARCH_LIMIT_PER_HOUR: '3' });
  });
  it('ADM4-P-12: el límite por omisión es de 30 por hora', async () => {
    await withApp(async (server) => {
      for (let index = 0; index < 30; index += 1) expect((await search(server, 'ZZZZZZ')).status).toBeLessThan(429);
      expect((await search(server, 'ZZZZZZ')).status).toBe(429);
    });
  });
  it('ADM4-P-13: falla cerrada: si el registro no se puede escribir, no se devuelve la reserva (503)', async () => {
    await withApp(async (server, log) => {
      log.record = async () => { throw new Error('db down'); };
      const response = await search(server, PNR);
      expect(response.status).toBe(503); expect(response.headers['retry-after']).toBeDefined(); expect(JSON.stringify(response.body)).not.toContain('Ana');
    });
  });
  it('ADM4-P-14: si Operations falla, no hay datos parciales: el error se registra y se propaga sin cuerpo de reserva', async () => {
    await withApp(async (server, log) => {
      operationsFailure = { code: 14, details: 'UNAVAILABLE' };
      const response = await search(server, PNR);
      expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain('Pérez'); expect(log.rows.at(-1)).toMatchObject({ subject: PNR, result: 'ERROR' });
    });
  });

  it('ADM4-P-15: cada desenlace escribe exactamente UNA fila, antes de responder, con su resultado', async () => {
    await withApp(async (server, log) => {
      const seen: Array<[string, number, number]> = []; const original = log.record.bind(log); let written = 0; log.record = async (entry) => { await original(entry); written = log.rows.length; };
      const step = async (name: string, run: () => Promise<{ status: number }>, expected: { result: string; subject: string | null; errorCode?: string | null }) => {
        const before = log.rows.length; written = before; const response = await run(); seen.push([name, written - before, response.status]);
        expect(log.rows.length - before).toBe(1); expect(written).toBe(log.rows.length); expect(log.rows.at(-1)).toMatchObject({ errorCode: null, ...expected });
      };
      await step('FOUND', () => search(server, PNR), { result: 'FOUND', subject: PNR });
      reservationFailure = { code: 5 }; await step('NOT_FOUND', () => search(server, 'ZZZZZZ'), { result: 'NOT_FOUND', subject: 'ZZZZZZ' });
      reservationFailure = { code: 14, details: 'connect ECONNREFUSED 10.0.0.1' }; await step('ERROR reservation', () => search(server, PNR), { result: 'ERROR', subject: PNR, errorCode: 'UNAVAILABLE' });
      reservationFailure = undefined; operationsFailure = { code: 4, details: 'deadline' }; await step('ERROR operations', () => search(server, PNR), { result: 'ERROR', subject: PNR, errorCode: 'DEADLINE_EXCEEDED' });
      operationsFailure = new Error('fallo propio del gateway con ana@example.com'); await step('ERROR del gateway', () => search(server, PNR), { result: 'ERROR', subject: PNR, errorCode: 'UNKNOWN_ERROR' });
      expect(seen.map(([name, count]) => [name, count])).toEqual(seen.map(([name]) => [name, 1]));
    });
  });
  it('ADM4-P-16: un límite alcanzado escribe UNA fila RATE_LIMITED; si el desenlace es un error del gateway la respuesta sigue siendo 500 sin datos', async () => {
    await withApp(async (server, log) => {
      await search(server, PNR); await search(server, PNR);
      const before = log.rows.length; const response = await search(server, PNR);
      expect(response.status).toBe(429); expect(log.rows.length - before).toBe(1); expect(log.rows.at(-1)).toMatchObject({ result: 'RATE_LIMITED', subject: null, errorCode: null });
    }, { ADMIN_PNR_SEARCH_LIMIT_PER_HOUR: '2' });
  });
  it('ADM4-P-16b (audit-40): con el límite alcanzado, un cuerpo inválido recibe 429 con Retry-After y una fila RATE_LIMITED (el límite va ANTES de validar; el 429 tiene precedencia sobre el 404)', async () => {
    await withApp(async (server, log) => {
      await search(server, PNR); await search(server, PNR);
      const before = log.rows.length; const response = await postRaw(server, '{}');
      expect(response.status).toBe(429); expect(response.headers['retry-after']).toBe('60'); expect(log.rows.length - before).toBe(1); expect(log.rows.at(-1)).toMatchObject({ result: 'RATE_LIMITED', subject: null });
    }, { ADMIN_PNR_SEARCH_LIMIT_PER_HOUR: '2' });
  });
  it('ADM4-P-17: el contador del límite falla ⇒ 503 sin datos y el intento se intenta registrar como ERROR (PROVIDER_UNAVAILABLE)', async () => {
    await withApp(async (server, log) => {
      log.countSince = async () => { throw new Error('db down'); };
      const response = await search(server, PNR);
      expect(response.status).toBe(503); expect(calls).toHaveLength(0); expect(JSON.stringify(response.body)).not.toContain('Ana'); expect(log.rows.at(-1)).toMatchObject({ result: 'ERROR', errorCode: 'PROVIDER_UNAVAILABLE', subject: null });
    });
  });
  it('ADM4-P-18: si escribir el registro falla en cualquier desenlace (inválido, no encontrada, error de servicio, límite) la respuesta es 503 sin datos', async () => {
    await withApp(async (server, log) => {
      log.record = async () => { throw new Error('db down'); };
      reservationFailure = undefined;
      const invalid = await postRaw(server, '{}'); const found = await search(server, PNR);
      reservationFailure = { code: 5 }; const missing = await search(server, 'ZZZZZZ'); reservationFailure = { code: 14 }; const failing = await search(server, PNR);
      for (const response of [invalid, found, missing, failing]) { expect(response.status).toBe(503); expect(response.body.code).toBe('PROVIDER_UNAVAILABLE'); expect(JSON.stringify(response.body)).not.toMatch(/Ana|Pérez|J4R8GZ|NOT_FOUND/); }
    });
  });

  it.each([
    ['sin HTTPS (X-Forwarded-Proto: http)', { 'X-Forwarded-Proto': 'http', Authorization: ADMIN }, 400],
    ['sin sesión', {}, 401],
    ['sesión inválida', { Authorization: 'Bearer no-es-un-token' }, 401],
    ['un cliente que no es administrador', { Authorization: CUSTOMER }, 403]
  ] as Array<[string, Record<string, string>, number]>)('ADM4-P-19: %s ⇒ rechazado ANTES del punto único y ninguna fila en el registro (no hay un administrador al que atribuirlo)', async (_name, headers, status) => {
    await withApp(async (server, log) => {
      for (const body of [{ pnr: PNR }, {}, { pnr: 5 }]) {
        const response = await request(server).post('/api/admin/v1/bookings/search').set(headers).send(body);
        expect(response.status).toBe(status); expect(response.headers['x-correlation-id']).toBeTruthy();
      }
      expect(log.rows).toHaveLength(0); expect(calls).toHaveLength(0);
    });
  });
  it('ADM4-P-20: un pedido sin sesión o de un no administrador, con cuerpo grande o ilegible, se rechaza por la autenticación/rol SIN leer el cuerpo', async () => {
    await withApp(async (server, log) => {
      for (const [headers, status] of [[{}, 401], [{ Authorization: 'Bearer no-es-un-token' }, 401], [{ Authorization: CUSTOMER }, 403]] as Array<[Record<string, string>, number]>) {
        for (const body of ['{"pnr":', JSON.stringify({ pnr: 'x'.repeat(300_000) })]) {
          const response = await request(server).post('/api/admin/v1/bookings/search').set(headers).set('Content-Type', 'application/json').send(body);
          expect(response.status).toBe(status); // con el lector global habría sido 400 (JSON ilegible) o 413 (grande) antes de autenticar
        }
      }
      expect(log.rows).toHaveLength(0);
    });
    // Con el lector reemplazado por un espía: solo lo invoca un administrador autenticado.
    const spy = jest.fn((_req: unknown, _res: unknown, next: () => void) => next());
    const bare = express(); mountAdminApiHttp(bare, loadConfig(env), undefined, spy as never);
    const post = (authorization?: string) => { const r = request(bare).post('/api/admin/v1/bookings/search').set('Content-Type', 'application/json'); return (authorization ? r.set('Authorization', authorization) : r).send('{"pnr":'); };
    expect((await post()).status).toBe(401); expect((await post('Bearer no-es-un-token')).status).toBe(401); expect((await post(CUSTOMER)).status).toBe(403); expect((await post(ADMIN_NO_SCOPE)).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    await post(ADMIN); expect(spy).toHaveBeenCalledTimes(1);
  });
});
