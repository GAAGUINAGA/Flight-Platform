import { afterAll, describe, expect, it } from '@jest/globals';
import { buildSchema, isObjectType } from 'graphql';
import { readSchemaSdl } from '@flight-platform/graphql-schema';
import request from 'supertest';
import { cleanupKeys, FakeGateway, makeApp, run, tokenFor, UUID_A, UUID_B } from './helpers';

afterAll(cleanupKeys);
const admin = { token: tokenFor('admin-1', 'admin') };
const row = (bookingId: string, at: string) => ({ bookingId, createdAt: at, channel: 'WEB', test: true, passengers: 2, owner: 'h4sh0paque', paymentReference: 'pay_ok_secreto', email: 'x@y.z', documentNumber: '1712345678' });
const CURSOR_1 = 'eyJjIjoiMjAyNi0xMS0xMlQxMDowMDowMFoiLCJpIjoiYSJ9';
interface Page { items: Array<Record<string, unknown>>; pageInfo: { endCursor: string | null; hasNextPage: boolean } }
const pageOf = (reply: { body: { data?: Record<string, unknown> | null } }): Page => (reply.body.data as { adminWebBookings: Page }).adminWebBookings;

describe('GQL-WEB: adminWebBookings (GET /api/admin/v1/web-bookings)', () => {
  it('GQL-WEB-01 autorización: sin token ⇒ UNAUTHENTICATED, cliente y socio ⇒ FORBIDDEN (sin llamar al Gateway); admin ⇒ llama con su token', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body: { items: [], nextCursor: null } })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'AdminWebBookings', {})).body.errors?.[0].extensions).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await run(app, 'AdminWebBookings', {}, { token: tokenFor('user-1') })).body.errors?.[0].extensions).toMatchObject({ code: 'FORBIDDEN', category: 'FORBIDDEN' });
    expect((await run(app, 'AdminWebBookings', {}, { token: tokenFor('booking', 'partner') })).body.errors?.[0].extensions.code).toBe('FORBIDDEN');
    expect(gateway.calls).toHaveLength(0);
    const reply = await run(app, 'AdminWebBookings', {}, admin); expect(reply.body.errors).toBeUndefined(); expect(reply.body.data).toEqual({ adminWebBookings: { items: [], pageInfo: { endCursor: null, hasNextPage: false } } });
    expect(gateway.calls).toHaveLength(1); expect(gateway.calls[0]).toMatchObject({ method: 'GET', path: '/api/admin/v1/web-bookings', query: { limit: 20 } }); expect(gateway.calls[0].headers.Authorization).toMatch(/^Bearer /);
  });
  it('GQL-WEB-02 paginación con cursor opaco: after ⇒ before sin tocarlo, nextCursor ⇒ endCursor sin tocarlo; dos páginas sin repetidos', async () => {
    const gateway = new FakeGateway((req) => req.query?.before === CURSOR_1 ? { status: 200, body: { items: [row(UUID_B, '2026-11-11T10:00:00Z')], nextCursor: null } } : { status: 200, body: { items: [row(UUID_A, '2026-11-12T10:00:00Z')], nextCursor: CURSOR_1 } });
    const { app } = makeApp({}, gateway);
    const first = await run(app, 'AdminWebBookings', { first: 1 }, admin); const page1 = pageOf(first);
    expect(page1.pageInfo).toEqual({ endCursor: CURSOR_1, hasNextPage: true }); expect(gateway.calls[0].query).toMatchObject({ limit: 1 }); expect(gateway.calls[0].query?.before).toBeUndefined();
    const second = await run(app, 'AdminWebBookings', { first: 1, after: page1.pageInfo.endCursor }, admin); const page2 = pageOf(second);
    expect(gateway.calls[1].query).toMatchObject({ limit: 1, before: CURSOR_1 }); expect(page2.pageInfo).toEqual({ endCursor: null, hasNextPage: false });
    const ids = [...page1.items, ...page2.items].map((item) => item.bookingId); expect(ids).toEqual([UUID_A, UUID_B]); expect(new Set(ids).size).toBe(2);
  });
  it('GQL-WEB-03 first por encima del máximo de la API interna (100), cero o negativo ⇒ VALIDATION sin llamar al Gateway; 100 se acepta', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body: { items: [], nextCursor: null } })); const { app } = makeApp({}, gateway);
    for (const first of [101, 0, -1]) expect({ first, ...((await run(app, 'AdminWebBookings', { first }, admin)).body.errors?.[0].extensions ?? {}) }).toMatchObject({ first, code: 'VALIDATION_FAILED', category: 'VALIDATION' });
    expect(gateway.calls).toHaveLength(0);
    expect((await run(app, 'AdminWebBookings', { first: 100 }, admin)).body.errors).toBeUndefined(); expect(gateway.calls[0].query).toMatchObject({ limit: 100 });
  });
  it('GQL-WEB-04 un cursor con caracteres ajenos al formato se rechaza en el servicio; uno que la API invalida (400) se traduce a VALIDATION', async () => {
    const gateway = new FakeGateway(() => ({ status: 400, body: { type: 'x', title: 'Solicitud inválida', status: 400, code: 'VALIDATION_FAILED', detail: 'cursor interno roto: stack…' } })); const { app } = makeApp({}, gateway);
    expect((await run(app, 'AdminWebBookings', { after: 'no valido/../' }, admin)).body.errors?.[0].extensions).toMatchObject({ code: 'VALIDATION_FAILED', category: 'VALIDATION' }); expect(gateway.calls).toHaveLength(0);
    const reply = await run(app, 'AdminWebBookings', { after: 'bm9fZXNfdW5fY3Vyc29y' }, admin);
    expect(reply.body.errors?.[0].extensions).toMatchObject({ code: 'VALIDATION_FAILED', category: 'VALIDATION', httpStatus: 400 }); expect(JSON.stringify(reply.body)).not.toContain('cursor interno roto'); expect(gateway.calls).toHaveLength(1);
  });
  it('GQL-WEB-05 solo los campos de la API interna: lo demás que devuelva el Gateway no llega, y el tipo no declara ninguno otro', async () => {
    const gateway = new FakeGateway(() => ({ status: 200, body: { items: [row(UUID_A, '2026-11-12T10:00:00Z')], nextCursor: null } })); const { app } = makeApp({}, gateway);
    const reply = await run(app, 'AdminWebBookings', {}, admin);
    expect(pageOf(reply).items[0]).toEqual({ bookingId: UUID_A, channel: 'WEB', createdAt: '2026-11-12T10:00:00Z', owner: 'h4sh0paque', passengers: 2, test: true });
    expect(JSON.stringify(reply.body)).not.toMatch(/pay_ok|x@y\.z|1712345678/);
    const type = buildSchema(readSchemaSdl()).getType('WebTestBooking'); expect(isObjectType(type) && Object.keys(type.getFields()).sort()).toEqual(['bookingId', 'channel', 'createdAt', 'owner', 'passengers', 'test']);
    // Una consulta libre (fuera de producción) que pida otro campo falla en la validación del esquema.
    const free = await request(app).post('/graphql').set('Authorization', `Bearer ${admin.token}`).set('Content-Type', 'application/json').send({ query: '{ adminWebBookings { items { bookingId paymentReference } } }' });
    expect(free.body.data).toBeUndefined(); expect(free.body.errors?.length).toBeGreaterThan(0);
  });
  it('GQL-WEB-06 los errores del Gateway se traducen como los demás (403 ⇒ FORBIDDEN, 503 ⇒ UNAVAILABLE) sin reenviar su cuerpo', async () => {
    for (const [status, code, category] of [[403, 'FORBIDDEN', 'FORBIDDEN'], [503, 'PROVIDER_UNAVAILABLE', 'UNAVAILABLE']] as const) {
      const { app } = makeApp({}, new FakeGateway(() => ({ status, body: { type: 'x', title: 'interno', status, code, detail: 'detalle interno' } })));
      const reply = await run(app, 'AdminWebBookings', {}, admin); expect(reply.body.errors?.[0].extensions).toMatchObject({ code, category }); expect(JSON.stringify(reply.body)).not.toContain('detalle interno');
    }
  });
});
