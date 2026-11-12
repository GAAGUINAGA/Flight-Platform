import { setTimeout as sleep } from 'node:timers/promises';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type { AuthContext } from '../auth';
import { loadConfig, type GatewayConfig } from '../config';
import { v2ProblemFromError } from './problem';

jest.mock('../grpc-clients', () => ({ callGatewayGrpc: jest.fn(), fetchSeatMap: jest.fn() }));
jest.mock('./events', () => ({ publishV2Event: jest.fn(async () => undefined) }));
import { callGatewayGrpc } from '../grpc-clients';
import { V2BookingController } from './booking.controller';
import { V2PostSaleController } from './postsale.controller';
import { InMemoryV2StateStore } from './state';
import { channelFor, warnWebSales } from './web-sales';

const HOLD = '00000000-0000-4000-8000-0000000000b1'; const BOOKING = '00000000-0000-4000-8000-0000000000c1'; const PAX = '00000000-0000-4000-8000-0000000000d1';
const baseEnv = { NODE_ENV: 'test', INTERNAL_API_KEY: 'x'.repeat(32), JWT_ISSUERS: JSON.stringify([{ iss: 'i', aud: 'a', jwksUri: 'https://example.test/jwks' }]) };
const config = (extra: Record<string, string> = {}): GatewayConfig => loadConfig({ ...baseEnv, ...extra });
const customer: AuthContext = { ownerId: 'user-1', role: 'customer', scopes: new Set(['flights:book']), emailVerified: true };
const partner: AuthContext = { ownerId: 'booking~u1', role: 'partner', scopes: new Set(['flights:book']), clientId: 'booking' };
const request = (auth: AuthContext, key = 'idem') => ({ auth, header: () => key, res: { getHeader: () => 'corr' } }) as unknown as Request;
const res = { status: jest.fn(), setHeader: jest.fn() } as unknown as Response;
const passenger = (id = PAX) => ({ passengerId: id, passengerType: 'ADULT', firstName: 'A', lastName: 'B', documentType: 'NATIONAL_ID', documentNumber: '1', nationality: 'EC', birthDate: '1990-01-01', gender: 'M', contact: { email: 'a@b.c', phone: '1' } });
const bookingBody = (extra: Record<string, unknown> = {}) => ({ holdId: HOLD, passengers: [passenger()], payment: { paymentReference: 'pay_ok_123' }, ...extra });
let calls: Array<{ method: string; input: Record<string, unknown> }> = [];
let listed: Array<{ status: string }> = [];
// Reservation simulada: tarda unos ms (para que las peticiones simultáneas se solapen) y el primer bookingId es BOOKING.
let created$ = 0; const bookingIdOf = (n: number): string => `00000000-0000-4000-8000-${(0xc1 + n - 1).toString(16).padStart(12, '0')}`;
const defaultCreate = async (): Promise<unknown> => { await sleep(5); created$ += 1; return { bookingId: bookingIdOf(created$), status: 'CONFIRMED' }; };
let createImpl: () => Promise<unknown> = defaultCreate; let holdAdults = 1;

beforeEach(() => {
  calls = []; listed = []; created$ = 0; createImpl = defaultCreate; holdAdults = 1;
  jest.mocked(callGatewayGrpc).mockImplementation(async (_config, _service, method, input) => {
    calls.push({ method, input: input as Record<string, unknown> });
    if (method === 'getOfferHold') return { status: 'HELD', expiresAt: new Date(Date.now() + 600_000).toISOString(), lockedPrice: { currency: 'USD', total: '10.00' }, passengersBreakdown: { adults: holdAdults }, itineraries: [{ segments: [{ departure: { iataCode: 'UIO', at: '2099-01-01T10:00:00Z' }, arrival: { iataCode: 'GYE' } }] }] };
    if (method === 'listReservations') return { items: listed };
    if (method === 'createReservation') return createImpl();
    if (method === 'getStoredCancellationQuote') return { quoteId: 'q1', isRefundable: true, refundAmount: '10.00', penaltyAmount: '0.00', currency: 'USD', expiresAt: '2099-01-01T00:00:00Z' };
    if (method === 'cancelReservation') return { bookingId: BOOKING, status: 'CANCELLED' };
    if (method === 'getReservation') return { bookingId: BOOKING, pnr: 'ABC123', status: 'CONFIRMED', grandTotal: { currency: 'USD', total: '10.00' }, createdAt: '2026-11-11T00:00:00Z', passengers: [{ passengerId: PAX }] };
    if (method === 'addBaggage') return { passengerId: PAX, itineraryId: 'i', totalBaggage: 1 };
    return {};
  });
});
const created = () => calls.find((call) => call.method === 'createReservation');
const problemOf = (error: unknown) => v2ProblemFromError(error, { method: 'POST', path: '/api/v2/vuelos/bookings' });

describe('B-1 canal WEB: el canal lo decide el rol del token', () => {
  it('WEB-CH-01: customer y admin → WEB; un token de socio (clientId) → BOOKING', () => {
    expect(channelFor(customer)).toBe('WEB'); expect(channelFor({ ...customer, role: 'admin' })).toBe('WEB'); expect(channelFor(partner)).toBe('BOOKING');
  });
  it('WEB-CH-02: sin WEB_PAYMENT_MODE no vende: 422 PAYMENT_NOT_AUTHORIZED con tipo propio y sin llamar a Reservation', async () => {
    const error = await new V2BookingController(config()).create(request(customer), res, bookingBody() as never).catch((e: unknown) => e);
    expect(problemOf(error)).toMatchObject({ status: 422, code: 'PAYMENT_NOT_AUTHORIZED', type: 'https://flight-platform.dev/problems/web-payments-disabled' });
    expect(created()).toBeUndefined(); expect(calls.some((call) => call.method === 'getOfferHold')).toBe(false);
  });
  it.each(['', 'off', 'SIMULATED', 'real', 'true'])('WEB-CH-03: WEB_PAYMENT_MODE=%j (valor desconocido) tampoco vende', async (mode) => {
    const error = await new V2BookingController(config({ WEB_PAYMENT_MODE: mode })).create(request(customer), res, bookingBody() as never).catch((e: unknown) => e);
    expect(problemOf(error)).toMatchObject({ status: 422, code: 'PAYMENT_NOT_AUTHORIZED' }); expect(created()).toBeUndefined();
  });
  it('WEB-CH-04: con simulated vende con paymentChannel WEB, deferIssuanceFailure y la reserva queda marcada como de prueba', async () => {
    const state = new InMemoryV2StateStore();
    const result = await new V2BookingController(config({ WEB_PAYMENT_MODE: 'simulated' }), state).create(request(customer), res, bookingBody() as never);
    expect(created()?.input).toMatchObject({ holdId: HOLD, paymentChannel: 'WEB', deferIssuanceFailure: true });
    expect((await state.findBooking(BOOKING))?.salesChannel).toEqual({ partnerId: 'WEB_TEST', passengers: 1 });
    expect(result).toMatchObject({ bookingId: BOOKING, salesChannel: { partnerId: 'WEB_TEST' } });
  });
  it('WEB-CH-05: el cliente no puede elegir el canal ni la marca por el cuerpo (salesChannel y provider se ignoran)', async () => {
    const state = new InMemoryV2StateStore();
    await new V2BookingController(config({ WEB_PAYMENT_MODE: 'simulated' }), state).create(request(customer), res, bookingBody({ salesChannel: { partnerId: 'BOOKING_PROTOTIPO' }, payment: { paymentReference: 'pay_ok_1', provider: 'BOOKING_PROTOTIPO' }, paymentChannel: 'BOOKING' }) as never);
    expect(created()?.input.paymentChannel).toBe('WEB'); expect((await state.findBooking(BOOKING))?.salesChannel).toMatchObject({ partnerId: 'WEB_TEST' });
  });
  it('WEB-CH-06: correo no confirmado → 403 FORBIDDEN con tipo email-not-verified', async () => {
    for (const auth of [{ ...customer, emailVerified: undefined }, { ...customer, emailVerified: false }]) {
      const error = await new V2BookingController(config({ WEB_PAYMENT_MODE: 'simulated' })).create(request(auth), res, bookingBody() as never).catch((e: unknown) => e);
      expect(problemOf(error)).toMatchObject({ status: 403, code: 'FORBIDDEN', type: 'https://flight-platform.dev/problems/email-not-verified' });
    }
    expect(created()).toBeUndefined();
  });
  it('WEB-CH-07: un socio sigue con su canal BOOKING sin interruptor ni correo y con su marca de venta', async () => {
    const state = new InMemoryV2StateStore();
    await new V2BookingController(config(), state).create(request(partner), res, bookingBody({ salesChannel: { partnerId: 'BOOKING_PROTOTIPO', partnerOrderId: 'ORD-1' } }) as never);
    expect(created()?.input).toMatchObject({ paymentChannel: 'BOOKING', deferIssuanceFailure: true });
    expect((await state.findBooking(BOOKING))?.salesChannel).toEqual({ partnerId: 'BOOKING_PROTOTIPO', partnerOrderId: 'ORD-1' });
    expect(calls.some((call) => call.method === 'listReservations')).toBe(false);
  });
});

describe('B-1 topes por usuario (los aplica Reservation; ADR-F12c-03)', () => {
  const on = (extra: Record<string, string> = {}) => config({ WEB_PAYMENT_MODE: 'simulated', ...extra });
  const limitType = (name: string) => `https://flight-platform.dev/problems/${name}`;
  const grpcError = (details: string) => Object.assign(new Error(details), { code: 8, details });
  it('WEB-LIM-01: el Gateway envía los topes configurados solo en el canal WEB (un socio no los lleva)', async () => {
    await new V2BookingController(on({ WEB_MAX_ACTIVE_BOOKINGS: '2', WEB_MAX_PASSENGERS_PER_DAY: '7' })).create(request(customer), res, bookingBody() as never);
    expect(created()?.input).toMatchObject({ paymentChannel: 'WEB', webMaxActiveBookings: 2, webMaxPassengersPerDay: 7 });
    calls = []; await new V2BookingController(config()).create(request(partner), res, bookingBody() as never);
    expect(created()?.input).not.toHaveProperty('webMaxActiveBookings'); expect(created()?.input).not.toHaveProperty('webMaxPassengersPerDay');
  });
  it('WEB-LIM-02: el rechazo de Reservation por reservas activas → 429 RATE_LIMIT_EXCEEDED con tipo web-active-bookings-limit; nada se guarda', async () => {
    const state = new InMemoryV2StateStore(); createImpl = async () => { throw grpcError('WEB_ACTIVE_LIMIT_EXCEEDED'); };
    const error = await new V2BookingController(on(), state).create(request(customer), res, bookingBody() as never).catch((e: unknown) => e);
    expect(problemOf(error)).toMatchObject({ status: 429, code: 'RATE_LIMIT_EXCEEDED', type: limitType('web-active-bookings-limit') }); expect(state.bookings.size).toBe(0);
  });
  it('WEB-LIM-03: el rechazo por pasajeros del día → 429 con tipo web-passengers-per-day-limit', async () => {
    createImpl = async () => { throw grpcError('WEB_PASSENGERS_LIMIT_EXCEEDED'); };
    const error = await new V2BookingController(on()).create(request(customer), res, bookingBody() as never).catch((e: unknown) => e);
    expect(problemOf(error)).toMatchObject({ status: 429, code: 'RATE_LIMIT_EXCEEDED', type: limitType('web-passengers-per-day-limit') });
  });
  it('WEB-LIM-04: un error cualquiera de Reservation (respuesta perdida, pago, 409) se propaga sin que el Gateway cuente, devuelva ni recalcule nada', async () => {
    const state = new InMemoryV2StateStore(); createImpl = async () => { throw Object.assign(new Error('x'), { code: 14, details: undefined }); };
    await expect(new V2BookingController(on(), state).create(request(customer), res, bookingBody() as never)).rejects.toBeDefined();
    expect(calls.some((call) => call.method === 'listReservations')).toBe(false); expect(state.bookings.size).toBe(0);
  });
  it('WEB-LIM-04b: el reintento con la misma Idempotency-Key reenvía la misma clave a Reservation (que devuelve la reserva existente); el Gateway no lleva lógica de cupo', async () => {
    const state = new InMemoryV2StateStore(); const controller = new V2BookingController(on(), state);
    await controller.create(request(customer, 'misma'), res, bookingBody() as never); await controller.create(request(customer, 'misma'), res, bookingBody() as never);
    expect(calls.filter((call) => call.method === 'createReservation').map((call) => call.input.idempotencyKey)).toEqual(['misma', 'misma']);
  });
  it.each([['0'], ['-1'], ['1.5'], ['abc']])('WEB-LIM-05: tope inválido %s → la configuración no arranca', (value) => {
    expect(() => config({ WEB_MAX_ACTIVE_BOOKINGS: value })).toThrow('WEB_MAX_ACTIVE_BOOKINGS'); expect(() => config({ WEB_MAX_PASSENGERS_PER_DAY: value })).toThrow('WEB_MAX_PASSENGERS_PER_DAY');
  });
  it('WEB-LIM-05b: aunque la configuración llegue con topes inválidos (construida a mano), el Gateway no vende ni llama a Reservation (falla cerrado)', async () => {
    for (const bad of [undefined, 0, -3, 1.5, Number.NaN]) {
      calls = []; const cfg = on(); const broken = { ...cfg, web: { ...cfg.web, maxActiveBookings: bad as never } } as GatewayConfig;
      const error = await new V2BookingController(broken).create(request(customer), res, bookingBody() as never).catch((e: unknown) => e);
      expect(problemOf(error)).toMatchObject({ status: 422, code: 'PAYMENT_NOT_AUTHORIZED' }); expect(created()).toBeUndefined();
    }
  });
  it('WEB-LIM-06: valores por defecto y exigencia de correo no desactivable en producción', () => {
    expect(config().web).toMatchObject({ paymentMode: 'off', maxActiveBookings: 5, maxPassengersPerDay: 10, requireVerifiedEmail: true });
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: 'production', WEB_REQUIRE_VERIFIED_EMAIL: 'false' })).toThrow('WEB_REQUIRE_VERIFIED_EMAIL');
  });
});

describe('B-1 postventa del canal WEB', () => {
  const baggage = { passengerId: PAX, itineraryId: '00000000-0000-4000-8000-0000000000f1', quantity: 1, payment: { paymentReference: 'pay_ok_9' } };
  it('WEB-PS-01: equipaje con el interruptor apagado → 422 y no llama a Reservation; con simulated usa el canal WEB', async () => {
    const off = await new V2PostSaleController(config()).baggage(request(customer), BOOKING, baggage).catch((e: unknown) => e);
    expect(problemOf(off)).toMatchObject({ status: 422, code: 'PAYMENT_NOT_AUTHORIZED' }); expect(calls.some((call) => call.method === 'addBaggage')).toBe(false);
    await new V2PostSaleController(config({ WEB_PAYMENT_MODE: 'simulated' })).baggage(request(customer), BOOKING, baggage);
    expect(calls.find((call) => call.method === 'addBaggage')?.input).toMatchObject({ paymentChannel: 'WEB' });
  });
  it('WEB-PS-02: un socio conserva el canal BOOKING en postventa', async () => {
    await new V2PostSaleController(config()).baggage(request(partner), BOOKING, baggage);
    expect(calls.find((call) => call.method === 'addBaggage')?.input).toMatchObject({ paymentChannel: 'BOOKING' });
  });
  it('WEB-PS-03: correo sin confirmar → 403 también en equipaje', async () => {
    const error = await new V2PostSaleController(config({ WEB_PAYMENT_MODE: 'simulated' })).baggage(request({ ...customer, emailVerified: undefined }), BOOKING, baggage).catch((e: unknown) => e);
    expect(problemOf(error)).toMatchObject({ status: 403, code: 'FORBIDDEN', type: 'https://flight-platform.dev/problems/email-not-verified' });
  });
});

describe('B-1 el createdAt del estado interno no sale hacia los clientes de v2', () => {
  it('WEB-CREATED-01: detalle y lista de reservas no exponen el createdAt del registro de estado (el createdAt visible es el de Reservation)', async () => {
    const STATE_DATE = new Date('2001-02-03T04:05:06.000Z'); const state = new InMemoryV2StateStore();
    await state.saveBooking({ bookingId: BOOKING, clientId: 'user-1', ownerId: 'user-1', holdId: HOLD, paymentReference: 'p', salesChannel: { partnerId: 'WEB_TEST', passengers: 1 }, passengerMap: {}, createdAt: STATE_DATE });
    expect((await state.findBooking(BOOKING))?.createdAt).toEqual(STATE_DATE);
    listed = [{ status: 'CONFIRMED', bookingId: BOOKING } as never];
    const controller = new V2BookingController(config({ WEB_PAYMENT_MODE: 'simulated' }), state);
    const detail = await controller.detail(request(customer), BOOKING); const list = await controller.list(request(customer), {});
    for (const body of [detail, list]) expect(JSON.stringify(body)).not.toContain('2001-02-03');
    expect(detail.createdAt).toBe('2026-11-11T00:00:00Z');
  });
});

describe('B-1 aviso al arrancar', () => {
  it('WEB-WARN-01: avisa si no está definida, si es desconocida y si es simulated', () => {
    const warn = jest.fn(); const logger = { warn } as never;
    warnWebSales(config(), logger); warnWebSales(config({ WEB_PAYMENT_MODE: 'otro' }), logger); warnWebSales(config({ WEB_PAYMENT_MODE: 'simulated' }), logger);
    expect(String(warn.mock.calls[0][0])).toContain('no está definida'); expect(String(warn.mock.calls[1][0])).toContain('desconocido'); expect(String(warn.mock.calls[2][0])).toContain('SIMULADO');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('x'.repeat(32));
  });
});
