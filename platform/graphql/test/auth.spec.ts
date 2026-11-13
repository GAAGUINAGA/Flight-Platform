import { afterAll, describe, expect, it } from '@jest/globals';
import { cleanupKeys, FakeGateway, forged, makeApp, run, tokenFor, UUID_A } from './helpers';

afterAll(cleanupKeys);
const ok = () => ({ status: 200, body: { bookingId: UUID_A, pnr: 'ABC123', status: 'CONFIRMED', grandTotal: { currency: 'USD', total: '1.00' }, createdAt: '2026-11-12T10:00:00Z' } });
const adminOps: Array<[string, Record<string, unknown>]> = [
  ['AdminFlights', {}], ['AdminFares', {}], ['FlightOperations', { date: '2026-12-01' }], ['PromotionAgreement', {}],
  ['UpdateFlightStatus', { flightNumber: 'FP103', input: { date: '2026-12-01', status: 'SCHEDULED' } }],
  ['SetPromotionAgreement', { input: { allowsPromotions: true, maxDiscountPercent: 10 }, idempotencyKey: UUID_A }]
];
const customerOps: Array<[string, Record<string, unknown>]> = [['Booking', { bookingId: UUID_A }], ['MyBookings', {}], ['Hold', { holdId: UUID_A }], ['CheckIn', { bookingId: UUID_A }], ['Viewer', {}], ['CancellationQuote', { bookingId: UUID_A }]];

describe('GQL-AUTH: autenticación y roles se resuelven ANTES de llamar al Gateway', () => {
  it.each(customerOps)('GQL-AUTH-01 %s sin token ⇒ UNAUTHENTICATED y el Gateway no recibe llamada', async (name, variables) => {
    const { app, gateway } = makeApp({}, new FakeGateway(ok)); const reply = await run(app, name, variables);
    expect(reply.body.errors?.[0].extensions).toMatchObject({ code: 'UNAUTHENTICATED', category: 'UNAUTHENTICATED' }); expect(gateway.calls).toHaveLength(0);
  });
  it.each(adminOps)('GQL-AUTH-02 %s con un customer ⇒ FORBIDDEN y el Gateway no recibe llamada; sin token ⇒ UNAUTHENTICATED', async (name, variables) => {
    const { app, gateway } = makeApp({}, new FakeGateway(ok));
    expect((await run(app, name, variables, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN', category: 'FORBIDDEN' });
    expect((await run(app, name, variables)).body.errors?.[0].extensions.code).toBe('UNAUTHENTICATED'); expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-AUTH-03 un partner se trata como customer sin privilegios (FORBIDDEN en @admin) y el admin sí pasa a llamar al Gateway', async () => {
    const { app, gateway } = makeApp({}, new FakeGateway(() => ({ status: 200, body: { items: [], page: {} } })));
    expect((await run(app, 'AdminFlights', {}, { token: tokenFor('booking', 'partner') })).body.errors?.[0].extensions.code).toBe('FORBIDDEN'); expect(gateway.calls).toHaveLength(0);
    const reply = await run(app, 'AdminFlights', {}, { token: tokenFor('admin-1', 'admin') }); expect(reply.body.errors).toBeUndefined(); expect(gateway.calls).toHaveLength(1);
  });
  it('GQL-AUTH-04 viewer expone solo userId y rol del JWT (sin llamar al Gateway)', async () => {
    const { app, gateway } = makeApp({}, new FakeGateway(ok));
    expect((await run(app, 'Viewer', {}, { token: tokenFor('abc-123', 'admin') })).body.data).toEqual({ viewer: { userId: 'abc-123', role: 'ADMIN' } }); expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-AUTH-05 tokens inválidos (firma alterada, alg none, HS256 con la llave pública, iss, aud o vencido) no autentican y no se reenvían', async () => {
    const good = tokenFor('user-1'); const expired = tokenFor('user-1', 'customer', { now: Math.floor(Date.now() / 1000) - 7200 });
    const bad = { firma: forged.badSignature(good), none: forged.none(), hs256: forged.hs256(), iss: tokenFor('user-1', 'customer', { iss: 'otro-emisor' }), aud: tokenFor('user-1', 'customer', { aud: 'otra-audiencia' }), vencido: expired, basura: 'no.es.jwt' };
    for (const [label, token] of Object.entries(bad)) {
      const { app, gateway } = makeApp({}, new FakeGateway(ok)); const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token });
      expect({ label, code: reply.body.errors?.[0].extensions.code }).toEqual({ label, code: 'UNAUTHENTICATED' }); expect(gateway.calls).toHaveLength(0);
      const publicReply = await run(app, 'FlightStatus', { flightNumber: 'FP103', date: '2026-12-01' }, { token }); expect(gateway.calls.every((call) => call.headers.Authorization === undefined)).toBe(true); void publicReply;
    }
  });
  it('GQL-AUTH-06 un token válido se reenvía idéntico al Gateway, que vuelve a validar; el servicio no guarda sesión', async () => {
    const token = tokenFor('user-1'); const { app, gateway } = makeApp({}, new FakeGateway(ok));
    await run(app, 'Booking', { bookingId: UUID_A }, { token }); await run(app, 'Booking', { bookingId: UUID_A }); expect(gateway.calls).toHaveLength(1); expect(gateway.calls[0].headers.Authorization).toBe(`Bearer ${token}`);
  });
});
