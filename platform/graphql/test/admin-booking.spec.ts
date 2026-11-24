import { afterAll, describe, expect, it } from '@jest/globals';
import { buildSchema, isObjectType } from 'graphql';
import { readSchemaSdl } from '@flight-platform/graphql-schema';
import request from 'supertest';
import { cleanupKeys, FakeGateway, makeApp, run, tokenFor, UUID_A } from './helpers';

afterAll(cleanupKeys);
const admin = { token: tokenFor('admin-1', 'admin') };
/** F12c-4a (ADR-F12c4-01): adminBookingByPnr (POST /api/admin/v1/bookings/search). Solo lectura; lista blanca; 404 ⇒ null. */
const body = {
  bookingId: UUID_A, pnr: 'J4R8GZ', status: 'CONFIRMED', channel: 'PARTNER', partnerRef: 'a1b2c3d4e5f6', createdAt: '2026-11-14T10:00:00.000Z', grandTotal: { currency: 'USD', total: '210.00' },
  segments: [{ segmentId: 's1', flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureAt: '2026-11-15T15:00:00.000Z', arrivalAt: '2026-11-15T17:00:00.000Z', departureLocal: '2026-11-15T10:00', arrivalLocal: '2026-11-15T11:00', status: 'SCHEDULED', cabinClass: 'ECONOMY' }],
  passengers: [{ passengerId: 'p1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Pérez', seats: [{ segmentId: 's1', seatNumber: '12A', status: 'CONFIRMED' }], extraBaggage: [{ itineraryId: 'i1', quantity: 1 }], documentNumber: 'AB1234567', contact: { email: 'ana@example.com', phone: '+593990000000' } }],
  tickets: [{ passengerId: 'p1', status: 'ISSUED', eTicketLast4: '7890', segments: [{ segmentId: 's1', status: 'ISSUED' }], eTicketNumber: '1234567890' }],
  checkIn: { status: 'COMPLETED', passengers: [{ passengerId: 'p1', status: 'CHECKED_IN', segments: [{ segmentId: 's1', status: 'CHECKED_IN', seat: '12A' }] }] },
  paymentReference: 'pay_secret_1', ownerId: 'cliente-x~u9'
};
const reply = (r: { body: { data?: Record<string, unknown> | null } }) => (r.body.data as { adminBookingByPnr: Record<string, unknown> | null }).adminBookingByPnr;

describe('GQL-PNR: adminBookingByPnr', () => {
  it('GQL-PNR-01 autorización: sin token ⇒ UNAUTHENTICATED; cliente y socio ⇒ FORBIDDEN sin llamar al Gateway; admin ⇒ POST con su token y el PNR en el cuerpo (no en la URL)', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'AdminBookingByPnr', { pnr: 'J4R8GZ' })).body.errors?.[0].extensions).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await run(app, 'AdminBookingByPnr', { pnr: 'J4R8GZ' }, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN' });
    expect((await run(app, 'AdminBookingByPnr', { pnr: 'J4R8GZ' }, { token: tokenFor('booking', 'partner') })).body.errors?.[0].extensions.code).toBe('FORBIDDEN');
    expect(gateway.calls).toHaveLength(0);
    const ok = await run(app, 'AdminBookingByPnr', { pnr: ' J4R8GZ ' }, admin); expect(ok.body.errors).toBeUndefined();
    expect(gateway.calls).toHaveLength(1); expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: '/api/admin/v1/bookings/search', body: { pnr: ' J4R8GZ ' } }); expect(gateway.calls[0].path).not.toContain('J4R8GZ'); expect(gateway.calls[0].headers.Authorization).toMatch(/^Bearer /);
  });
  it('GQL-PNR-02 devuelve nombres, asientos, equipaje, boletos (últimos 4), horas locales y check-in; nada de documento, correo, teléfono, pago, dueño ni boleto completo', async () => {
    const { app } = makeApp({}, new FakeGateway(() => ({ status: 200, body }))); const result = reply(await run(app, 'AdminBookingByPnr', { pnr: 'J4R8GZ' }, admin)) as Record<string, unknown>;
    expect(result).toMatchObject({ pnr: 'J4R8GZ', channel: 'PARTNER', partnerRef: 'a1b2c3d4e5f6', checkIn: { status: 'COMPLETED' }, grandTotal: { currency: 'USD', total: '210.00' } });
    expect((result.passengers as Array<Record<string, unknown>>)[0]).toMatchObject({ firstName: 'Ana', lastName: 'Pérez' }); expect((result.segments as Array<Record<string, unknown>>)[0]).toMatchObject({ departureLocal: '2026-11-15T10:00', arrivalLocal: '2026-11-15T11:00' });
    expect((result.tickets as Array<Record<string, unknown>>)[0].eTicketLast4).toBe('7890');
    expect(JSON.stringify(result)).not.toMatch(/AB1234567|ana@example\.com|\+593990000000|pay_secret_1|cliente-x|1234567890|ownerId|paymentReference/);
  });
  it('GQL-PNR-02b (decisión 9) el check-in UNKNOWN del Gateway (Operations no respondió) llega tal cual, sin error y sin convertirlo en «sin check-in»', async () => {
    const { app } = makeApp({}, new FakeGateway(() => ({ status: 200, body: { ...body, checkIn: { status: 'UNKNOWN', passengers: [] } } })));
    const result = await run(app, 'AdminBookingByPnr', { pnr: 'J4R8GZ' }, admin);
    expect(result.body.errors).toBeUndefined(); expect(reply(result)).toMatchObject({ pnr: 'J4R8GZ', checkIn: { status: 'UNKNOWN', passengers: [] } });
  });
  it('GQL-PNR-03 el tipo no declara ningún campo personal ni de pago: una consulta libre que lo pida falla en la validación', async () => {
    const schema = buildSchema(readSchemaSdl()); const names = Object.entries(schema.getTypeMap()).filter(([name]) => /^Admin(Booking|CheckIn)/.test(name)).flatMap(([, type]) => isObjectType(type) ? Object.keys(type.getFields()) : []);
    expect(names.length).toBeGreaterThan(20); for (const forbidden of ['documentNumber', 'documentType', 'documentExpiryDate', 'birthDate', 'nationality', 'contact', 'email', 'phone', 'paymentReference', 'ownerId', 'owner', 'clientId', 'eTicketNumber', 'barcode']) expect(names).not.toContain(forbidden);
    const { app } = makeApp({}, new FakeGateway(() => ({ status: 200, body })));
    for (const field of ['passengers { documentNumber }', 'passengers { contact { email } }', 'paymentReference']) {
      const free = await request(app).post('/graphql').set('Authorization', `Bearer ${admin.token}`).set('Content-Type', 'application/json').send({ query: `{ adminBookingByPnr(pnr: "J4R8GZ") { ${field} } }` });
      expect(free.body.data).toBeUndefined(); expect(free.body.errors?.length).toBeGreaterThan(0);
    }
  });
  it('GQL-PNR-04 un 404 del Gateway (inexistente, ajeno o inválido) ⇒ null sin error, igual en los tres casos', async () => {
    const problem = { type: 'x', title: 'Not Found', status: 404, code: 'NOT_FOUND', detail: 'Booking not found' }; const { app } = makeApp({}, new FakeGateway(() => ({ status: 404, body: problem })));
    const results = [await run(app, 'AdminBookingByPnr', { pnr: 'ZZZZZZ' }, admin), await run(app, 'AdminBookingByPnr', { pnr: 'J4R8G0' }, admin), await run(app, 'AdminBookingByPnr', { pnr: 'texto' }, admin)];
    for (const result of results) { expect(result.body.errors).toBeUndefined(); expect(result.body.data).toEqual({ adminBookingByPnr: null }); }
  });
  it('GQL-PNR-05 un PNR vacío o larguísimo NO se rechaza aquí (el Gateway lo clasifica y lo registra): llega TAL CUAL (sin recortar ni alterar)', async () => {
    const gateway = new FakeGateway(() => ({ status: 404, body: { type: 'x', title: 'Not Found', status: 404, code: 'NOT_FOUND' } })); const { app } = makeApp({}, gateway);
    for (const pnr of ['', '   ', 'A'.repeat(500)]) expect((await run(app, 'AdminBookingByPnr', { pnr }, admin)).body.data).toEqual({ adminBookingByPnr: null });
    expect(gateway.calls.map((call) => (call.body as { pnr: string }).pnr)).toEqual(['', '   ', 'A'.repeat(500)]);
  });
  it('GQL-PNR-06 el límite (429) y la dependencia caída (503) se traducen sin reenviar el cuerpo del Gateway', async () => {
    for (const [status, code] of [[429, 'RATE_LIMIT_EXCEEDED'], [503, 'PROVIDER_UNAVAILABLE']] as const) {
      const { app } = makeApp({}, new FakeGateway(() => ({ status, retryAfter: 60, body: { type: 'x', title: 'interno', status, code, detail: 'detalle interno' } })));
      const result = await run(app, 'AdminBookingByPnr', { pnr: 'J4R8GZ' }, admin); expect(result.body.errors?.[0].extensions).toMatchObject({ code }); expect(JSON.stringify(result.body)).not.toContain('detalle interno');
    }
  });
});
