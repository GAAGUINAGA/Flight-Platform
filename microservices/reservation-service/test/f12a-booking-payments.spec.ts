/* global fetch, Response, RequestInit */
import { describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { BookingPaymentVerifier, BookingPaymentsConfig, PaymentProviderUnavailable, bookingPaymentsConfigFromEnv, warnIfVerificationOff } from '../src/infrastructure/clients/booking-payments';
import { DEFAULT_FIELDS, DEFAULT_STATUS_MAP, classifyStatus, parseFields, parseStatusMap, pickField } from '../src/infrastructure/clients/payment-status-map';

const SECRET = 'booking-credential-must-not-leak';
const reply = (body: unknown, init: { status?: number } = {}) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } });
const make = (fetchImpl: typeof fetch, overrides: Partial<BookingPaymentsConfig> = {}) => new BookingPaymentVerifier({ baseUrl: 'http://100.64.1.2:8080/api', pathTemplate: '/pagos/{paymentReference}', authHeader: 'Authorization', authValue: `Bearer ${SECRET}`, timeoutMs: 500, statusMap: DEFAULT_STATUS_MAP, fields: DEFAULT_FIELDS, verify: 'on', fetchImpl, ...overrides });
const input = { paymentReference: 'PAY-BKP-001', currency: 'USD', total: '100.00' };
const rejection = async (promise: Promise<unknown>): Promise<unknown> => { try { await promise; return undefined; } catch (error) { return error; } };

describe('F12a verificador de pagos de Booking (D4)', () => {
  it('PAY-01: confirmado con monto y moneda iguales autoriza y consulta la URL esperada con la credencial', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const verifier = make((async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string> }; return new Response(JSON.stringify({ estado: 'CONFIRMADO', monto: 100, moneda: 'USD' })); }) as unknown as typeof fetch);
    await expect(verifier.verify(input)).resolves.toBe('AUTHORIZED');
    expect(seen).toMatchObject({ url: 'http://100.64.1.2:8080/api/pagos/PAY-BKP-001', headers: { Authorization: `Bearer ${SECRET}`, accept: 'application/json' } });
  });
  it('PAY-02: pendiente devuelve PENDING', async () => { await expect(make(reply({ estado: 'PENDIENTE', monto: 100 }) as never).verify(input)).resolves.toBe('PENDING'); });
  it('PAY-03: fallido responde PAYMENT_NOT_AUTHORIZED', async () => { await expect(make(reply({ estado: 'FALLIDO' }) as never).verify(input)).rejects.toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' }); });
  it('PAY-04: referencia inexistente (404) responde PAYMENT_NOT_AUTHORIZED', async () => { await expect(make(reply({}, { status: 404 }) as never).verify(input)).rejects.toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' }); });
  it('PAY-05: confirmado con monto distinto responde AMOUNT_MISMATCH', async () => { await expect(make(reply({ estado: 'CONFIRMADO', monto: 99.99, moneda: 'USD' }) as never).verify(input)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' }); });
  it('PAY-06: confirmado con otra moneda responde AMOUNT_MISMATCH', async () => { await expect(make(reply({ estado: 'CONFIRMADO', monto: 100, moneda: 'EUR' }) as never).verify(input)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' }); });
  it('PAY-07: confirmado sin monto no se puede verificar y responde AMOUNT_MISMATCH', async () => { await expect(make(reply({ estado: 'CONFIRMADO' }) as never).verify(input)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' }); });
  it('PAY-08: un estado que no está en el mapa se trata como no autorizado', async () => { await expect(make(reply({ estado: 'ESTADO_NUEVO_RARO', monto: 100 }) as never).verify(input)).rejects.toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' }); });
  it('PAY-09: sin moneda en la respuesta se asume la de la operación', async () => { await expect(make(reply({ estado: 'PAID', amount: '100.00' }) as never).verify(input)).resolves.toBe('AUTHORIZED'); });
  it('PAY-10: Booking sin conexión o 5xx es proveedor no disponible (UNAVAILABLE)', async () => {
    for (const impl of [(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, reply({}, { status: 500 }) as never, reply({}, { status: 503 }) as never]) { const error = await rejection(make(impl).verify(input)); expect(error).toBeInstanceOf(PaymentProviderUnavailable); expect((error as { code: number }).code).toBe(status.UNAVAILABLE); }
  });
  it('PAY-11: 401 y 403 (nuestra credencial rechazada) también son proveedor no disponible', async () => {
    for (const code of [401, 403]) expect(await rejection(make(reply({}, { status: code }) as never).verify(input))).toBeInstanceOf(PaymentProviderUnavailable);
  });
  it('PAY-12: un cuerpo que no es JSON es proveedor no disponible', async () => { expect(await rejection(make(reply('<html>oops</html>') as never).verify(input))).toBeInstanceOf(PaymentProviderUnavailable); });
  it('PAY-13: sin respuesta dentro del plazo propio el verificador falla rápido', async () => {
    const hang = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('aborted'))); })) as unknown as typeof fetch;
    const started = Date.now(); const error = await rejection(make(hang, { timeoutMs: 150 }).verify(input));
    expect(error).toBeInstanceOf(PaymentProviderUnavailable); expect(Date.now() - started).toBeLessThan(1500);
  });
  it('PAY-14: sin BOOKING_PAYMENTS_BASE_URL nunca autoriza: falla como proveedor no disponible', async () => {
    let called = false; const verifier = make((async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch, { baseUrl: undefined });
    expect(await rejection(verifier.verify(input))).toBeInstanceOf(PaymentProviderUnavailable); expect(called).toBe(false);
  });
  it('PAY-15: verify=off (solo perfil local) autoriza sin consultar a nadie', async () => {
    let called = false; await expect(make((async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch, { verify: 'off' }).verify(input)).resolves.toBe('AUTHORIZED'); expect(called).toBe(false);
  });
  it('PAY-16: el mapa de estados y los campos se cambian solo por configuración', async () => {
    const statusMap = parseStatusMap(JSON.stringify({ CONFIRMED: ['LIQUIDADO'] })); const fields = parseFields(JSON.stringify({ status: ['estado_pago'], amount: ['valor'] }));
    await expect(make(reply({ estado_pago: 'liquidado', valor: '100.00' }) as never, { statusMap, fields }).verify(input)).resolves.toBe('AUTHORIZED');
    await expect(make(reply({ estado: 'CONFIRMADO', monto: 100 }) as never, { statusMap, fields }).verify(input)).rejects.toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' });
  });
  it('PAY-17: acepta la respuesta envuelta en data y el monto como número, texto u objeto', async () => {
    for (const body of [{ data: { status: 'confirmed', amount: 100, currency: 'usd' } }, { payment: { estado: 'PAGADO', monto: '100' } }, { status: 'SUCCESS', amount: { total: '100.00', currency: 'USD' } }]) await expect(make(reply(body) as never).verify(input)).resolves.toBe('AUTHORIZED');
  });
  it('PAY-18: la referencia se codifica en la ruta y no permite salirse de ella', async () => {
    let seen = ''; const verifier = make((async (url: string) => { seen = url; return new Response(JSON.stringify({ estado: 'PENDIENTE' })); }) as unknown as typeof fetch);
    await verifier.verify({ ...input, paymentReference: 'PAY/../admin?x=1#y' }); expect(seen).toBe('http://100.64.1.2:8080/api/pagos/PAY%2F..%2Fadmin%3Fx%3D1%23y');
  });
  it('PAY-19: una redirección no se sigue y cuenta como proveedor no disponible', async () => {
    let options: RequestInit | undefined; const verifier = make((async (_url: string, init: RequestInit) => { options = init; return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }); }) as unknown as typeof fetch);
    expect(await rejection(verifier.verify(input))).toBeInstanceOf(PaymentProviderUnavailable); expect(options?.redirect).toBe('manual');
  });
  it('PAY-20: ningún error expone la credencial ni la respuesta de Booking', async () => {
    const error = await rejection(make(reply({ estado: 'FALLIDO', detalle: 'dato interno de Booking' }, { status: 500 }) as never).verify(input));
    expect(String(error) + JSON.stringify(error)).not.toContain(SECRET); expect(String(error)).not.toContain('dato interno');
  });
  it('PAY-21: void y refund no hacen nada (el reembolso lo ejecuta Booking)', async () => { const verifier = make(reply({}) as never); await expect(verifier.void()).resolves.toBeUndefined(); await expect(verifier.refund()).resolves.toBeUndefined(); });

  it('PAY-22: classifyStatus ignora mayúsculas, acentos y espacios', () => {
    expect(classifyStatus(' En proceso ')).toBe('PENDING'); expect(classifyStatus('Aprobado')).toBe('CONFIRMED'); expect(classifyStatus('rechazado')).toBe('FAILED'); expect(classifyStatus('???')).toBeUndefined(); expect(classifyStatus(42)).toBeUndefined();
  });
  it('PAY-23: pickField busca alias y envoltorios y devuelve undefined si no hay', () => {
    expect(pickField({ data: { total: 5 } }, ['amount', 'total'])).toBe(5); expect(pickField([], ['a'])).toBeUndefined(); expect(pickField({ a: null }, ['a'])).toBeUndefined();
  });
  it('PAY-24: la configuración por entorno valida URL, plazo, plantilla y JSON', () => {
    expect(() => bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_BASE_URL: 'ftp://x' })).toThrow('http(s) URL');
    expect(() => bookingPaymentsConfigFromEnv({ NODE_ENV: 'production', BOOKING_PAYMENTS_BASE_URL: 'http://pagos.example' })).toThrow('https in production');
    expect(() => bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_TIMEOUT_MS: '9000' })).toThrow('5 s budget');
    expect(() => bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_TIMEOUT_MS: '10' })).toThrow('5 s budget');
    expect(() => bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_PATH_TEMPLATE: '/pagos' })).toThrow('{paymentReference}');
    expect(() => bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_STATUS_MAP: '{no' })).toThrow('valid JSON');
    expect(() => bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_FIELDS: '[]' })).toThrow('must be an object');
  });
  it('PAY-25: verify=off exige INTEGRATION_LOCAL=true y el perfil local se rechaza en producción', () => {
    expect(() => bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_VERIFY: 'off' })).toThrow('requires INTEGRATION_LOCAL=true');
    expect(bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_VERIFY: 'off', INTEGRATION_LOCAL: 'true' }).verify).toBe('off');
    expect(() => bookingPaymentsConfigFromEnv({ NODE_ENV: 'production', INTEGRATION_LOCAL: 'true' })).toThrow('INTEGRATION_LOCAL is forbidden in production');
  });
  it('PAY-28: verify=off con NODE_ENV=production se rechaza al arrancar', () => {
    expect(() => bookingPaymentsConfigFromEnv({ NODE_ENV: 'production', BOOKING_PAYMENTS_VERIFY: 'off' })).toThrow();
    expect(() => bookingPaymentsConfigFromEnv({ NODE_ENV: 'production', BOOKING_PAYMENTS_VERIFY: 'off', INTEGRATION_LOCAL: 'true' })).toThrow('INTEGRATION_LOCAL is forbidden in production');
  });
  it('PAY-29: con verify=off cada pago autorizado sin verificar deja un aviso sin datos sensibles', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const verifier = make(reply({}) as never, { verify: 'off' }); await verifier.verify({ ...input, paymentReference: 'PAY-SECRETO-777' }); await verifier.verify(input);
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.filter((m) => m.includes('SIN VERIFICAR'))).toHaveLength(2); expect(messages.join('|')).not.toMatch(/PAY-SECRETO-777|PAY-BKP-001|100\.00|Bearer/);
    } finally { warn.mockRestore(); }
  });
  it('PAY-30: al arrancar con verify=off se avisa y con verify=on no', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      warnIfVerificationOff(bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_VERIFY: 'off', INTEGRATION_LOCAL: 'true' })); expect(warn).toHaveBeenCalledTimes(1);
      warnIfVerificationOff(bookingPaymentsConfigFromEnv({})); expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  it('PAY-26: los valores por defecto son seguros: verificación activa, sin URL, plazo de 2,5 s', () => {
    expect(bookingPaymentsConfigFromEnv({})).toMatchObject({ verify: 'on', baseUrl: undefined, timeoutMs: 2500, pathTemplate: '/pagos/{paymentReference}', authHeader: 'Authorization' });
  });
  it('PAY-27: la URL base se normaliza sin barras finales y la plantilla se puede cambiar', async () => {
    const config = bookingPaymentsConfigFromEnv({ BOOKING_PAYMENTS_BASE_URL: 'http://100.64.1.2:9000/v2//', BOOKING_PAYMENTS_PATH_TEMPLATE: '/payments/{paymentReference}/status' });
    let seen = ''; await new BookingPaymentVerifier({ ...config, fetchImpl: (async (url: string) => { seen = url; return new Response(JSON.stringify({ estado: 'PENDIENTE' })); }) as unknown as typeof fetch }).verify(input);
    expect(seen).toBe('http://100.64.1.2:9000/v2/payments/PAY-BKP-001/status/'.replace(/\/$/, ''));
  });
  // ADR-F12b2fix-02: el pago de Booking incluye su servicio; basta con que cubra el total (630 nuestros + 63 de Booking = 693).
  const BOOKING_REAL = { payment_reference: 'PAY-BKP-20261108-226306', status: 'CAPTURED', amount: 693, refunded_amount: 0, currency: 'USD', captured_at: '2026-11-08T22:18:22.600Z', auth_code: 'AUTH-PAG-BE3D6520', bookings: [] };
  const reservation630 = { paymentReference: 'PAY-BKP-20261108-226306', currency: 'USD', total: '630.00' };
  it('PAY-31: la respuesta real de Booking (CAPTURED, 693) cubre una reserva de 630 y se acepta', async () => {
    await expect(make(reply(BOOKING_REAL) as never).verify(reservation630)).resolves.toBe('AUTHORIZED');
  });
  it('PAY-32: la misma respuesta real con REFUNDED se rechaza como no autorizada', async () => {
    await expect(make(reply({ ...BOOKING_REAL, status: 'REFUNDED', refunded_amount: 693 }) as never).verify(reservation630)).rejects.toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' });
  });
  it('PAY-33: monto igual y mayor autorizan; menor (incluso por un centavo) es AMOUNT_MISMATCH', async () => {
    await expect(make(reply({ status: 'CAPTURED', amount: 630, currency: 'USD' }) as never).verify(reservation630)).resolves.toBe('AUTHORIZED');
    await expect(make(reply({ status: 'CAPTURED', amount: 630.01, currency: 'USD' }) as never).verify(reservation630)).resolves.toBe('AUTHORIZED');
    await expect(make(reply({ status: 'CAPTURED', amount: 629.99, currency: 'USD' }) as never).verify(reservation630)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
    await expect(make(reply({ status: 'CAPTURED', amount: 63, currency: 'USD' }) as never).verify(reservation630)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
  });
  it('PAY-34: monto mayor pero en otra moneda sigue siendo AMOUNT_MISMATCH', async () => {
    await expect(make(reply({ status: 'CAPTURED', amount: 693, currency: 'EUR' }) as never).verify(reservation630)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
  });
  it('PAY-35: CAPTURED y CAPTURADO se reconocen como confirmados; PENDING y un estado desconocido no autorizan', async () => {
    expect(classifyStatus('CAPTURED')).toBe('CONFIRMED'); expect(classifyStatus('captured')).toBe('CONFIRMED'); expect(classifyStatus('Capturado')).toBe('CONFIRMED');
    await expect(make(reply({ status: 'PENDING', amount: 693, currency: 'USD' }) as never).verify(reservation630)).resolves.toBe('PENDING');
    await expect(make(reply({ status: 'CHARGEBACK', amount: 693, currency: 'USD' }) as never).verify(reservation630)).rejects.toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' });
  });
  it('PAY-36: con monto mayor se registra la diferencia en unidades menores, sin referencia, pnr ni credencial', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await make(reply(BOOKING_REAL) as never).verify(reservation630);
      const messages = log.mock.calls.map((call) => String(call[0])); expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('exceeds the reservation total by 6300 minor units'); expect(messages[0]).not.toMatch(/PAY-BKP|AUTH-PAG|Bearer|\b693\b|\b630\b/);
      await make(reply({ status: 'CAPTURED', amount: 630, currency: 'USD' }) as never).verify(reservation630); expect(log).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
  it('PAY-37: BOOKING_PAYMENTS_FIELDS permite tomar nuestro monto de otro campo (p. ej. bookings[] aplanado como our_amount)', async () => {
    const fields = parseFields(JSON.stringify({ amount: ['our_amount'] }));
    await expect(make(reply({ ...BOOKING_REAL, our_amount: '630.00' }) as never, { fields }).verify(reservation630)).resolves.toBe('AUTHORIZED');
    await expect(make(reply({ ...BOOKING_REAL, our_amount: '600.00' }) as never, { fields }).verify(reservation630)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
  });
});
