import { afterAll, describe, expect, it } from '@jest/globals';
import { cleanupKeys, FakeGateway, makeApp, run, tokenFor } from './helpers';

afterAll(cleanupKeys);
const admin = { token: tokenFor('admin-1', 'admin') };
const KEY = '8f1b0b8e-6c4e-4a52-9a8e-0b6f2c1d3e4f';
const FLIGHT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
/** F12c-4b/4c: adminCheckIn, adminBoardingPasses, adminAircraftCatalog, createFlight, openFlightForSale. */
const checkIn = { bookingId: FLIGHT_ID, status: 'COMPLETED', checkedInPassengers: [{ passengerId: 'p1', status: 'CHECKED_IN', segments: [{ segmentId: 's1', status: 'CHECKED_IN', seat: '12A' }] }], ownerId: 'cliente-x~u9', documentNumber: 'AB1234567' };
const created = { flightInstanceId: FLIGHT_ID, flightNumber: 'FP210', status: 'CLOSED', closed: true, aircraft: 'E190', origin: 'UIO', destination: 'GPS', departureAt: '2026-12-01T20:00:00.000Z', arrivalAt: '2026-12-01T22:00:00.000Z', departureLocal: '2026-12-01T15:00', arrivalLocal: '2026-12-01T16:00', durationMinutes: 120, cabins: [{ cabinClass: 'ECONOMY', capacity: 99 }], fares: [{ cabinClass: 'ECONOMY', fareBrand: 'Basic', currency: 'USD', baseFare: '80.00', taxes: '20.00', total: '100.00' }] };
const input = { flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureLocal: '2026-12-01T15:00', durationMinutes: 120, aircraft: 'E190', openForSale: false, fares: [{ cabinClass: 'ECONOMY', fareBrand: 'Basic', baseFare: '80.00', taxes: '20.00', isRefundable: false, isChangeable: true, carryOnIncluded: 1, checkedBaggageIncluded: 0, extraBaggagePrice: '35.00' }] };

describe('F12c-4b: adminCheckIn y adminBoardingPasses', () => {
  it('GQL-CI-01: solo admin (sin token ⇒ UNAUTHENTICATED; cliente y socio ⇒ FORBIDDEN sin llamar al Gateway); el Gateway recibe SOLO el PNR y la Idempotency-Key; la respuesta no trae dueño ni documento', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body: checkIn })); const { app } = makeApp({}, gateway); const variables = { pnr: 'J4R8GZ', idempotencyKey: KEY };
    expect((await run(app, 'AdminCheckIn', variables)).body.errors?.[0].extensions).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await run(app, 'AdminCheckIn', variables, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN' });
    expect((await run(app, 'AdminCheckIn', variables, { token: tokenFor('booking', 'partner') })).body.errors?.[0].extensions.code).toBe('FORBIDDEN');
    expect(gateway.calls).toHaveLength(0);
    const ok = await run(app, 'AdminCheckIn', variables, admin); expect(ok.body.errors).toBeUndefined();
    expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: '/api/admin/v1/bookings/check-in', body: { pnr: 'J4R8GZ' } }); expect(gateway.calls[0].headers['Idempotency-Key']).toBe(KEY); expect(Object.keys(gateway.calls[0].body as object)).toEqual(['pnr']);
    expect(JSON.stringify(ok.body)).not.toMatch(/cliente-x|AB1234567|ownerId|documentNumber/); expect(ok.body.data).toMatchObject({ adminCheckIn: { status: 'COMPLETED', checkedInPassengers: [{ passengerId: 'p1', segments: [{ seat: '12A' }] }] } });
  });
  it('GQL-CI-02: la operación no declara dueño ni bookingId (una variable de más se ignora y NO viaja); la clave de idempotencia es obligatoria y UUID', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body: checkIn })); const { app } = makeApp({}, gateway);
    for (const variables of [{ pnr: 'J4R8GZ' }, { pnr: 'J4R8GZ', idempotencyKey: 'no-uuid' }]) expect((await run(app, 'AdminCheckIn', variables, admin)).body.errors?.length).toBeGreaterThan(0);
    expect(gateway.calls).toHaveLength(0);
    await run(app, 'AdminCheckIn', { pnr: 'J4R8GZ', idempotencyKey: KEY, ownerId: 'x', bookingId: FLIGHT_ID }, admin);
    expect(gateway.calls).toHaveLength(1); expect(JSON.stringify(gateway.calls[0])).not.toMatch(/ownerId|"x"/); expect(gateway.calls[0].body).toEqual({ pnr: 'J4R8GZ' });
  });
  it('GQL-CI-03: las reglas del negocio y el límite llegan como errores públicos sin el cuerpo interno', async () => {
    for (const [status, code] of [[409, 'CHECK_IN_NOT_AVAILABLE'], [409, 'BOOKING_NOT_CONFIRMED'], [429, 'RATE_LIMIT_EXCEEDED'], [503, 'PROVIDER_UNAVAILABLE']] as const) {
      const { app } = makeApp({}, new FakeGateway(() => ({ status, retryAfter: 60, body: { type: 'x', title: 'interno', status, code, detail: 'detalle interno' } })));
      const result = await run(app, 'AdminCheckIn', { pnr: 'J4R8GZ', idempotencyKey: KEY }, admin); expect(result.body.errors?.length).toBe(1); expect(JSON.stringify(result.body)).not.toContain('detalle interno');
    }
  });
  it('GQL-BP-01: los pases se piden por PNR (en el cuerpo), 404 ⇒ null, y solo admin', async () => {
    const passes = { bookingId: FLIGHT_ID, boardingPasses: [{ passengerId: 'p1', segmentId: 's1', seat: '12A', barcode: 'M1/abc/12A', barcodeType: 'QR', cabinClass: 'ECONOMY' }] };
    const gateway = new FakeGateway(() => ({ status: 200, body: passes })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'AdminBoardingPasses', { pnr: 'J4R8GZ' }, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN' }); expect(gateway.calls).toHaveLength(0);
    const ok = await run(app, 'AdminBoardingPasses', { pnr: 'J4R8GZ' }, admin); expect(ok.body.data).toMatchObject({ adminBoardingPasses: { boardingPasses: [{ seat: '12A', barcode: 'M1/abc/12A', barcodeType: 'QR' }] } });
    expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: '/api/admin/v1/bookings/boarding-passes', body: { pnr: 'J4R8GZ' } }); expect(gateway.calls[0].path).not.toContain('J4R8GZ');
    const missing = makeApp({}, new FakeGateway(() => ({ status: 404, body: { type: 'x', title: 'NF', status: 404, code: 'NOT_FOUND' } })));
    expect((await run(missing.app, 'AdminBoardingPasses', { pnr: 'ZZZZZZ' }, admin)).body.data).toEqual({ adminBoardingPasses: null });
  });
});

describe('F12c-4c: createFlight, openFlightForSale y adminAircraftCatalog', () => {
  it('GQL-CF-01: solo admin; el Gateway recibe el cuerpo en lista blanca con la Idempotency-Key; la respuesta es el vuelo creado', async () => {
    const gateway = new FakeGateway(() => ({ status: 201, body: created })); const { app } = makeApp({}, gateway); const variables = { input, idempotencyKey: KEY };
    expect((await run(app, 'CreateFlight', variables)).body.errors?.[0].extensions).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await run(app, 'CreateFlight', variables, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN' });
    expect((await run(app, 'CreateFlight', variables, { token: tokenFor('booking', 'partner') })).body.errors?.[0].extensions.code).toBe('FORBIDDEN');
    expect(gateway.calls).toHaveLength(0);
    const ok = await run(app, 'CreateFlight', variables, admin); expect(ok.body.errors).toBeUndefined();
    expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: '/api/admin/v1/flights', body: input }); expect(gateway.calls[0].headers['Idempotency-Key']).toBe(KEY);
    expect(ok.body.data).toMatchObject({ createFlight: { flightNumber: 'FP210', status: 'CLOSED', closed: true, departureLocal: '2026-12-01T15:00', arrivalLocal: '2026-12-01T16:00', fares: [{ total: '100.00' }] } });
  });
  it('GQL-CF-02: sin idempotencyKey (o no UUID) no se llama al Gateway; un campo que el esquema no declara se rechaza', async () => {
    const gateway = new FakeGateway(() => ({ status: 201, body: created })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'CreateFlight', { input }, admin)).body.errors?.length).toBeGreaterThan(0);
    expect((await run(app, 'CreateFlight', { input, idempotencyKey: 'x' }, admin)).body.errors?.length).toBeGreaterThan(0);
    expect((await run(app, 'CreateFlight', { input: { ...input, closed: false }, idempotencyKey: KEY }, admin)).body.errors?.length).toBeGreaterThan(0);
    expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-CF-03: un 400 de validación, un duplicado (409) y la caída parcial (503) llegan como errores públicos sin el detalle interno', async () => {
    for (const [status, code] of [[400, 'VALIDATION_FAILED'], [409, 'FLIGHT_ALREADY_EXISTS'], [409, 'IDEMPOTENCY_KEY_REUSED'], [503, 'PROVIDER_UNAVAILABLE']] as const) {
      const { app } = makeApp({}, new FakeGateway(() => ({ status, retryAfter: 5, body: { type: 'x', title: 'interno', status, code, detail: 'detalle interno', invalidParams: [{ name: 'departureLocal', reason: 'too-soon' }] } })));
      const result = await run(app, 'CreateFlight', { input, idempotencyKey: KEY }, admin); expect(result.body.errors?.length).toBe(1); expect(JSON.stringify(result.body)).not.toContain('detalle interno');
    }
  });
  it('GQL-CF-04: abrir a la venta — POST con la clave y el id en la ruta; solo admin; un id que no es UUID no sale de GraphQL', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body: { flightInstanceId: FLIGHT_ID, status: 'OPEN', closed: false } })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'OpenFlightForSale', { flightInstanceId: FLIGHT_ID, idempotencyKey: KEY }, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN' });
    expect((await run(app, 'OpenFlightForSale', { flightInstanceId: '../x', idempotencyKey: KEY }, admin)).body.errors?.length).toBeGreaterThan(0); expect(gateway.calls).toHaveLength(0);
    const ok = await run(app, 'OpenFlightForSale', { flightInstanceId: FLIGHT_ID, idempotencyKey: KEY }, admin); expect(ok.body.data).toEqual({ openFlightForSale: { flightInstanceId: FLIGHT_ID, status: 'OPEN', closed: false } });
    expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: `/api/admin/v1/flights/${FLIGHT_ID}/open` });
  });
  it('GQL-CF-05: el catálogo de aviones solo lo lee el admin', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body: { aircraft: [{ code: 'E190', cabins: [{ cabinClass: 'ECONOMY', seats: 99 }] }] } })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'AdminAircraftCatalog', {}, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN' }); expect(gateway.calls).toHaveLength(0);
    expect((await run(app, 'AdminAircraftCatalog', {}, admin)).body.data).toEqual({ adminAircraftCatalog: [{ code: 'E190', cabins: [{ cabinClass: 'ECONOMY', seats: 99 }] }] });
  });
});
