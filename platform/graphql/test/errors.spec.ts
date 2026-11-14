import { afterAll, describe, expect, it } from '@jest/globals';
import { fromGatewayFailure } from '../src/domain/errors';
import { cleanupKeys, FakeGateway, makeApp, run, tokenFor, UUID_A } from './helpers';

afterAll(cleanupKeys);
const customer = tokenFor('user-1');
const BASE = 'https://flight-platform.dev/problems/';

/** Tabla completa del diseño §6.3: cada `code` del enum de ProblemDetails v2 con su HTTP produce category, extensions.code y mensaje propio. */
const TABLE: Array<[number, string, string]> = [
  [400, 'VALIDATION_FAILED', 'VALIDATION'],
  [401, 'UNAUTHORIZED', 'UNAUTHENTICATED'],
  [403, 'FORBIDDEN', 'FORBIDDEN'],
  [404, 'NOT_FOUND', 'NOT_FOUND'], [404, 'FLIGHT_STATUS_NOT_AVAILABLE', 'NOT_FOUND'],
  ...['SEAT_TAKEN', 'OFFER_NO_LONGER_AVAILABLE', 'HOLD_ALREADY_CONSUMED', 'BOOKING_NOT_CONFIRMED', 'BOOKING_NOT_CANCELLABLE', 'ALREADY_CANCELLED', 'TICKET_ALREADY_ISSUED', 'FARE_NOT_CHANGEABLE', 'FLIGHT_ALREADY_DEPARTED', 'FLIGHT_CANCELLED', 'CUTOFF_PASSED', 'CHECK_IN_NOT_AVAILABLE', 'BOARDING_PASS_NOT_AVAILABLE', 'QUOTE_EXPIRED', 'INVALID_STATUS_TRANSITION', 'IDEMPOTENCY_KEY_REUSED'].map((code): [number, string, string] => [409, code, 'CONFLICT']),
  ...['HOLD_EXPIRED', 'CHANGE_OFFER_EXPIRED'].map((code): [number, string, string] => [410, code, 'GONE']),
  ...['INFANT_SEAT_NOT_ALLOWED', 'SEAT_CABIN_MISMATCH', 'INFANT_WITHOUT_ADULT', 'PASSENGER_COUNT_MISMATCH', 'DOCUMENT_EXPIRED', 'PASSPORT_REQUIRED_INTERNATIONAL', 'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED', 'AMOUNT_MISMATCH', 'CHECK_IN_FAILED', 'BAGGAGE_LIMIT_EXCEEDED', 'PROMOTION_DISCOUNT_OUT_OF_RANGE'].map((code): [number, string, string] => [422, code, 'UNPROCESSABLE']),
  [429, 'RATE_LIMIT_EXCEEDED', 'RATE_LIMITED'],
  [503, 'PROVIDER_UNAVAILABLE', 'UNAVAILABLE'], [503, 'RATE_LIMIT_EXCEEDED', 'UNAVAILABLE'], [502, 'PROVIDER_UNAVAILABLE', 'UNAVAILABLE'], [504, 'PROVIDER_UNAVAILABLE', 'UNAVAILABLE'],
  [500, 'INTERNAL_ERROR', 'INTERNAL'], [400, 'TICKET_ISSUANCE_FAILED', 'VALIDATION'], [409, 'PNR_CREATION_FAILED', 'CONFLICT']
];

describe('GQL-ERR: ProblemDetails v2 → errores de GraphQL con extensiones controladas', () => {
  it.each(TABLE)('GQL-ERR-01 HTTP %i con code %s ⇒ category %s, extensions.code y un mensaje propio (el detail del Gateway no sale)', async (status, code, category) => {
    const gateway = new FakeGateway(() => ({ status, body: { type: 'https://x/e', title: 'T', status, code, detail: 'DETALLE INTERNO secreto@example.com', correlation_id: 'c1' } })); const { app } = makeApp({}, gateway);
    const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer, correlationId: 'corr-err-1' }); const error = reply.body.errors?.[0];
    expect(reply.status).toBe(200); expect(reply.body.data).toBeNull(); expect(error?.path).toEqual(['booking']);
    const expectedCode = code === 'UNAUTHORIZED' ? 'UNAUTHENTICATED' : code; expect(error?.extensions).toMatchObject({ code: expectedCode, category, httpStatus: status, correlationId: 'corr-err-1' });
    expect(error?.message.length).toBeGreaterThan(5); expect(JSON.stringify(reply.body)).not.toContain('DETALLE INTERNO'); expect(JSON.stringify(reply.body)).not.toContain('secreto@example.com');
  });
  it('GQL-ERR-02 401 y 403 con VALIDATION_FAILED (guardia heredado) se deciden por HTTP', () => {
    expect(fromGatewayFailure({ status: 401, body: { code: 'VALIDATION_FAILED' } })).toMatchObject({ category: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED' });
    expect(fromGatewayFailure({ status: 403, body: { code: 'VALIDATION_FAILED' } })).toMatchObject({ category: 'FORBIDDEN', code: 'FORBIDDEN' });
  });
  it.each([
    [429, 'RATE_LIMIT_EXCEEDED', 'web-active-bookings-limit', 'WEB_ACTIVE_BOOKINGS_LIMIT', 'RATE_LIMITED'],
    [429, 'RATE_LIMIT_EXCEEDED', 'web-passengers-per-day-limit', 'WEB_PASSENGERS_PER_DAY_LIMIT', 'RATE_LIMITED'],
    [403, 'FORBIDDEN', 'email-not-verified', 'EMAIL_NOT_VERIFIED', 'FORBIDDEN'],
    [422, 'PAYMENT_NOT_AUTHORIZED', 'web-payments-disabled', 'WEB_PAYMENTS_DISABLED', 'UNPROCESSABLE']
  ])('GQL-ERR-09 HTTP %i %s con type %s ⇒ extensions.code %s (category por HTTP) sin reenviar el type', async (status, code, type, expected, category) => {
    const gateway = new FakeGateway(() => ({ status, body: { type: `https://flight-platform.dev/problems/${type}`, title: 'T', status, code, detail: 'DETALLE INTERNO' } })); const { app } = makeApp({}, gateway);
    const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer }); const error = reply.body.errors?.[0];
    expect(error?.extensions).toMatchObject({ code: expected, category, httpStatus: status });
    const text = JSON.stringify(reply.body); expect(text).not.toContain('flight-platform.dev'); expect(text).not.toContain(type); expect(text).not.toContain('DETALLE INTERNO');
  });
  it('GQL-ERR-10 un type desconocido, ajeno o sin la forma esperada se ignora: sigue el comportamiento por code y category', () => {
    expect(fromGatewayFailure({ status: 429, body: { type: 'https://x/problems/otro-tope', code: 'RATE_LIMIT_EXCEEDED' } })).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', category: 'RATE_LIMITED' });
    expect(fromGatewayFailure({ status: 403, body: { type: 'https://x/problems/constructor', code: 'FORBIDDEN' } })).toMatchObject({ code: 'FORBIDDEN' });
    expect(fromGatewayFailure({ status: 403, body: { type: { x: 1 }, code: 'FORBIDDEN' } })).toMatchObject({ code: 'FORBIDDEN' });
    expect(fromGatewayFailure({ status: 422, body: { type: `${BASE}web-payments-disabled`, code: 'PAYMENT_NOT_AUTHORIZED' }, invalidBody: true })).toMatchObject({ code: 'UNKNOWN_GATEWAY_ERROR' });
    expect(fromGatewayFailure({ status: 422, body: { type: `${BASE}web-payments-disabled`, code: 'PAYMENT_NOT_AUTHORIZED' } })).toMatchObject({ code: 'WEB_PAYMENTS_DISABLED' });
  });
  it('GQL-ERR-11 solo la URL completa y exacta del Gateway se traduce: mismo nombre desde otro dominio, variaciones, ausente o no texto se ignoran', () => {
    const expectIgnored = (type: unknown): void => expect(fromGatewayFailure({ status: 422, body: { type, code: 'PAYMENT_NOT_AUTHORIZED' } })).toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED', category: 'UNPROCESSABLE' });
    for (const name of ['web-active-bookings-limit', 'web-passengers-per-day-limit', 'email-not-verified', 'web-payments-disabled']) {
      expectIgnored(`https://otro.example/problems/${name}`); expectIgnored(`https://flight-platform.dev.otro.example/problems/${name}`); expectIgnored(`http://flight-platform.dev/problems/${name}`);
      expectIgnored(`https://FLIGHT-PLATFORM.dev/problems/${name}`); expectIgnored(`https://flight-platform.dev/problems/${name.toUpperCase()}`); expectIgnored(`https://flight-platform.dev/problems/${name}/`);
      expectIgnored(` https://flight-platform.dev/problems/${name}`); expectIgnored(`https://flight-platform.dev/problems/${name} `); expectIgnored(`https://flight-platform.dev/problems/${name}?x=1`);
      expectIgnored(`https://flight-platform.dev/problems/${name}#a`); expectIgnored(`https://flight-platform.dev/otros/${name}`); expectIgnored(`https://flight-platform.dev/problems//${name}`); expectIgnored(name); expectIgnored(`/problems/${name}`);
    }
    for (const type of [undefined, null, 42, true, ['https://flight-platform.dev/problems/web-payments-disabled'], { href: 'https://flight-platform.dev/problems/web-payments-disabled' }, '']) expectIgnored(type);
    expect(fromGatewayFailure({ status: 422, body: {} })).toMatchObject({ code: 'UNKNOWN_GATEWAY_ERROR' });
  });
  it('GQL-ERR-03 503 con Retry-After ⇒ retryAfterSeconds (extensión y cabecera); 429 también', async () => {
    const gateway = new FakeGateway(() => ({ status: 503, retryAfter: '7', body: { code: 'RATE_LIMIT_EXCEEDED', status: 503 } })); const { app } = makeApp({}, gateway);
    const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer }); expect(reply.body.errors?.[0].extensions).toMatchObject({ category: 'UNAVAILABLE', code: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: 7 }); expect(reply.headers['retry-after']).toBe('7');
    gateway.responder = () => ({ status: 429, retryAfter: '30', body: { code: 'RATE_LIMIT_EXCEEDED' } }); expect((await run(app, 'Booking', { bookingId: UUID_A }, { token: customer })).body.errors?.[0].extensions).toMatchObject({ category: 'RATE_LIMITED', retryAfterSeconds: 30 });
  });
  it('GQL-ERR-04 un código desconocido se transmite como UNKNOWN_GATEWAY_ERROR con la category por HTTP', async () => {
    const gateway = new FakeGateway(() => ({ status: 409, body: { code: 'CODIGO_NUEVO_DEL_FUTURO' } })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'Booking', { bookingId: UUID_A }, { token: customer })).body.errors?.[0].extensions).toMatchObject({ code: 'UNKNOWN_GATEWAY_ERROR', category: 'CONFLICT' });
  });
  it('GQL-ERR-05 cuerpo no JSON, 5xx sin cuerpo y éxito con cuerpo inválido ⇒ INTERNAL/UNAVAILABLE sin detalles', async () => {
    const { app, gateway } = makeApp();
    gateway.responder = () => ({ status: 500, invalidBody: true }); expect((await run(app, 'Booking', { bookingId: UUID_A }, { token: customer })).body.errors?.[0].extensions).toMatchObject({ code: 'INTERNAL_ERROR', category: 'INTERNAL' });
    gateway.responder = () => ({ status: 502, invalidBody: true }); expect((await run(app, 'Booking', { bookingId: UUID_A }, { token: customer })).body.errors?.[0].extensions).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', category: 'UNAVAILABLE' });
    gateway.responder = () => ({ status: 200, invalidBody: true }); expect((await run(app, 'Booking', { bookingId: UUID_A }, { token: customer })).body.errors?.[0].extensions.category).toBe('UNAVAILABLE');
  });
  it('GQL-ERR-06 invalidParams: solo name y reason con caracteres seguros; lo demás del cuerpo no sale', async () => {
    const gateway = new FakeGateway(() => ({ status: 400, body: { code: 'VALIDATION_FAILED', invalidParams: [{ name: 'passengers[0].assignedSeats[0]', reason: 'Asiento no válido', extra: 'x' }, { name: '<script>', reason: 'malo' }, { name: 'ok', reason: 'texto con <html> y `comillas`' }] } })); const { app } = makeApp({}, gateway);
    const error = (await run(app, 'Booking', { bookingId: UUID_A }, { token: customer })).body.errors?.[0]; expect(error?.extensions.invalidParams).toEqual([{ name: 'passengers[0].assignedSeats[0]', reason: 'Asiento no válido' }, { name: 'ok' }]);
  });
  it('GQL-ERR-07 un fallo de red del Gateway ⇒ GATEWAY_UNAVAILABLE; una excepción inesperada ⇒ INTERNAL_ERROR sin stack ni mensaje', async () => {
    const down = makeApp({}, new FakeGateway(() => { throw new Error('ECONNREFUSED 10.0.0.5:443 secreto interno'); }));
    const reply = await run(down.app, 'Booking', { bookingId: UUID_A }, { token: customer }); expect(reply.body.errors?.[0].extensions).toMatchObject({ code: 'INTERNAL_ERROR', category: 'INTERNAL' });
    const text = JSON.stringify(reply.body); expect(text).not.toContain('ECONNREFUSED'); expect(text).not.toContain('10.0.0.5'); expect(text).not.toMatch(/stack|at .*\.ts|node_modules/i);
  });
  it('GQL-ERR-08 un recurso ajeno (404 del Gateway) llega como NOT_FOUND sin detalle: el servicio no distingue ajeno de inexistente y no filtra por dueño', async () => {
    const gateway = new FakeGateway(() => ({ status: 404, body: { code: 'NOT_FOUND', detail: 'la reserva pertenece a otro usuario' } })); const { app } = makeApp({}, gateway);
    const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer }); expect(reply.body.errors?.[0].extensions).toMatchObject({ code: 'NOT_FOUND', category: 'NOT_FOUND' }); expect(JSON.stringify(reply.body)).not.toContain('otro usuario'); expect(gateway.calls).toHaveLength(1);
  });
});
