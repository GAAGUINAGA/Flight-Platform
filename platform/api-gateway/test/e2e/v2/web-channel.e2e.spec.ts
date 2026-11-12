import { Buffer } from 'node:buffer';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createDevToken } from '../../../../../infra/scripts/dev-token';
import { expectSchema, expectV2Response } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, headers, hold, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
const dir = mkdtempSync(join(tmpdir(), 'web-channel-')); const publicKeyFile = join(dir, 'public.pem'); writeFileSync(publicKeyFile, keys.publicKey);
const issuers = JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile }]);
const USER_SCOPES = 'flights:read flights:hold flights:book flights:cancel';
/** Token de un usuario de Supabase: `email_verified` de nivel superior solo si se pide (lo agrega el hook). */
const supabase = (sub: string, role = 'customer', verified = true, scope = USER_SCOPES) => `Bearer ${createDevToken(keys.privateKey, { sub, app_role: role, scope, ...(verified ? { email_verified: true } : {}) } as never)}`;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const holdAs = async (stack: Stack, s: Scenario, auth: string, breakdown = { adults: 1 }) => {
  const offer = await s.search(breakdown);
  const response = await request(stack.server).post('/api/v2/vuelos/offers/hold').set('Authorization', auth).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: breakdown });
  expect(response.status).toBe(201);
  return { holdId: response.body.holdId as string, lockedPrice: response.body.lockedPrice as { currency: string; total: string } };
};
const reserve = (stack: Stack, auth: string, held: { holdId: string; lockedPrice: { currency: string; total: string } }, reference = `pay_ok_${randomUUID()}`, extra: Record<string, unknown> = {}) =>
  request(stack.server).post('/api/v2/vuelos/bookings').set('Authorization', auth).set('Idempotency-Key', randomUUID()).send({ holdId: held.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: reference, amount: held.lockedPrice }, ...extra });

describeReal('F12c B-1 · canal WEB con servicios reales (WEB_PAYMENT_MODE=simulated)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  beforeAll(async () => { stack = await startStack({ JWT_ISSUERS: issuers, WEB_PAYMENT_MODE: 'simulated', WEB_MAX_ACTIVE_BOOKINGS: '2' }); }, 240_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 180_000);
  const scenario = async () => { const s = await stack.scenario({ sellable: 8 }); scenarios.push(s); return s; };
  // Los dueños de estas pruebas son el sub del usuario de Supabase: se limpian por ese prefijo.
  const cleanupUsers = async (...subs: string[]) => { const owned = { OR: subs.map((id) => ({ ownerId: id })) }; const rows = await stack.db.reservation.reservation.findMany({ where: owned, select: { id: true } }); await stack.db.ticketing.ticket.deleteMany({ where: owned }); await stack.db.ticketing.issuanceRequest.deleteMany({ where: { bookingId: { in: rows.map((row) => row.id) } } }); await stack.db.operations.checkIn.deleteMany({ where: owned }); await stack.db.ancillaries.baggageAllowance.deleteMany({ where: owned }); await stack.db.ancillaries.baggageItem.deleteMany({ where: owned }); await stack.db.ancillaries.seatAssignment.deleteMany({ where: owned }); await stack.db.ancillaries.bookingOwner.deleteMany({ where: owned }); await stack.db.reservation.reservation.deleteMany({ where: owned }); await stack.db.pricing.priceLock.deleteMany({ where: owned }); await stack.db.inventory.reservedInventory.deleteMany({ where: owned }); await stack.db.inventory.hold.deleteMany({ where: owned }); };

  it('WEB-E2E-01 un cliente con correo confirmado reserva con pago simulado: 201 CONFIRMED, marcada como de prueba y con canal WEB en los datos', async () => {
    const s = await scenario(); const sub = `web-${randomUUID()}`; const auth = supabase(sub);
    try {
      const held = await holdAs(stack, s, auth); const response = await reserve(stack, auth, held);
      expect(response.status).toBe(201); expectSchema('BookingDetail', response.body); expect(response.body.status).toBe('CONFIRMED');
      expect(response.body.salesChannel).toMatchObject({ partnerId: 'WEB_TEST', passengers: 1 });
      expect((await stack.db.reservation.reservation.findUnique({ where: { id: response.body.bookingId } }))?.paymentChannel).toBe('WEB');
      const admin = await request(stack.server).get('/api/admin/v1/web-bookings').set('Authorization', supabase('admin-1', 'admin', true, `${USER_SCOPES} flights:webhooks flights:admin`));
      expect(admin.status).toBe(200); expect(admin.body.items.some((item: { bookingId: string; test: boolean; channel: string }) => item.bookingId === response.body.bookingId && item.test && item.channel === 'WEB')).toBe(true);
      expect(JSON.stringify(admin.body)).not.toContain(sub);
      // El createdAt del registro de estado no viaja a los clientes de v2: GET y lista validados con Ajv contra el contrato v2 (que ya trae el createdAt de Reservation).
      const detail = await request(stack.server).get(`/api/v2/vuelos/bookings/${response.body.bookingId}`).set('Authorization', auth); expect(detail.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}', 200, detail.body);
      const list = await request(stack.server).get('/api/v2/vuelos/bookings').set('Authorization', auth); expect(list.status).toBe(200); expectV2Response('GET', '/vuelos/bookings', 200, list.body);    } finally { await cleanupUsers(sub); }
  }, 240_000);

  it('WEB-E2E-02 pago rechazado, correo sin confirmar y referencia de Booking en el canal WEB no venden', async () => {
    const s = await scenario(); const sub = `web-${randomUUID()}`; const auth = supabase(sub);
    try {
      const held = await holdAs(stack, s, auth);
      const unverified = await reserve(stack, supabase(sub, 'customer', false), held); expect(unverified.status).toBe(403); expect(unverified.body).toMatchObject({ code: 'FORBIDDEN', type: 'https://flight-platform.dev/problems/email-not-verified' }); expectSchema('ProblemDetails', unverified.body);
      const denied = await reserve(stack, auth, held, `pay_denied_${randomUUID()}`); expect(denied.status).toBe(422); expect(denied.body.code).toBe('PAYMENT_NOT_AUTHORIZED');
      const bookingRef = await reserve(stack, auth, held, 'PAY-BKP-20261108-000001'); expect(bookingRef.status).toBe(422); expect(bookingRef.body.code).toBe('PAYMENT_REFERENCE_INVALID');
      expect(await stack.db.reservation.reservation.count({ where: { ownerId: sub } })).toBe(0);
      expect((await reserve(stack, auth, held)).status).toBe(201);
    } finally { await cleanupUsers(sub); }
  }, 240_000);

  it('WEB-E2E-03 tope de reservas activas por usuario (2): la tercera ⇒ 429 con tipo propio; otro usuario no se ve afectado', async () => {
    const s = await scenario(); const sub = `web-${randomUUID()}`; const other = `web-${randomUUID()}`; const auth = supabase(sub);
    try {
      for (let i = 0; i < 2; i += 1) expect((await reserve(stack, auth, await holdAs(stack, s, auth))).status).toBe(201);
      const third = await reserve(stack, auth, await holdAs(stack, s, auth)); expect(third.status).toBe(429); expect(third.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', type: 'https://flight-platform.dev/problems/web-active-bookings-limit' }); expectSchema('ProblemDetails', third.body);
      expect((await reserve(stack, supabase(other), await holdAs(stack, s, supabase(other)))).status).toBe(201);
    } finally { await cleanupUsers(sub, other); }
  }, 300_000);

  it('WEB-E2E-04 aislamiento: un cliente no ve ni toca las reservas de otro cliente ni las de un socio, y viceversa', async () => {
    const s = await scenario(); const a = `web-${randomUUID()}`; const b = `web-${randomUUID()}`; const authA = supabase(a); const authB = supabase(b);
    try {
      const mine = await reserve(stack, authA, await holdAs(stack, s, authA)); expect(mine.status).toBe(201); const id = mine.body.bookingId as string;
      const partnerHeld = await hold(stack, s, s.client, 'u1'); const theirs = await book(stack, s, s.client, 'u1', partnerHeld); expect(theirs.response.status).toBe(201); const partnerId = theirs.response.body.bookingId as string;
      const partnerHeaders = { Authorization: (await headers(stack, s.client, 'u1')).Authorization, 'X-User-Id': 'u1' };
      const get = (path: string, auth: string, extra: Record<string, string> = {}) => request(stack.server).get(path).set('Authorization', auth).set(extra);
      expect((await get(`/api/v2/vuelos/bookings/${id}`, authA)).status).toBe(200);
      for (const path of [`/api/v2/vuelos/bookings/${id}`, `/api/v2/vuelos/bookings/${id}/tickets`, `/api/v2/vuelos/bookings/${id}/boarding-passes`, `/api/v2/vuelos/bookings/${id}/cancellation-quote`, `/api/v2/vuelos/bookings/${id}/baggage-options`]) {
        const other = await get(path, authB, { 'X-User-Id': a }); expect(other.status).toBe(404);
        expect((await get(path, partnerHeaders.Authorization, { 'X-User-Id': a })).status).toBe(404);
      }
      for (const path of [`/api/v2/vuelos/bookings/${partnerId}`, `/api/v2/vuelos/bookings/${partnerId}/tickets`, `/api/v2/vuelos/bookings/${partnerId}/cancellation-quote`]) expect((await get(path, authA, { 'X-User-Id': 'u1' })).status).toBe(404);
      const cancelOther = await request(stack.server).post(`/api/v2/vuelos/bookings/${id}/cancel`).set('Authorization', authB).set('Idempotency-Key', randomUUID()).send({ quoteId: 'QTE-1' }); expect(cancelOther.status).toBe(404);
      const checkInOther = await request(stack.server).post(`/api/v2/vuelos/bookings/${id}/check-in`).set('Authorization', authB); expect(checkInOther.status).toBe(404);
      const listB = await get('/api/v2/vuelos/bookings', authB); expect(listB.status).toBe(200); expect(listB.body.items.map((item: { bookingId: string }) => item.bookingId)).not.toContain(id); expect(listB.body.items.map((item: { bookingId: string }) => item.bookingId)).not.toContain(partnerId);
      const listA = await get('/api/v2/vuelos/bookings', authA); expect(listA.body.items.map((item: { bookingId: string }) => item.bookingId)).toEqual([id]);
      const listPartner = await get('/api/v2/vuelos/bookings', partnerHeaders.Authorization, { 'X-User-Id': 'u1' }); expect(listPartner.body.items.map((item: { bookingId: string }) => item.bookingId)).toContain(partnerId); expect(listPartner.body.items.map((item: { bookingId: string }) => item.bookingId)).not.toContain(id);
    } finally { await cleanupUsers(a, b); }
  }, 300_000);

  it('WEB-E2E-05 un socio conserva su canal BOOKING: su pago se verifica contra Booking y una pay_ok_* no se acepta', async () => {
    const s = await scenario(); const held = await hold(stack, s, s.client, 'u1');
    const fake = await book(stack, s, s.client, 'u1', held, { reference: `pay_ok_${randomUUID()}`, confirm: false }); expect(fake.response.status).toBe(422); expect(fake.response.body.code).toBe('PAYMENT_NOT_AUTHORIZED');
    const real = await book(stack, s, s.client, 'u1', held); expect(real.response.status).toBe(201);
    expect((await stack.db.reservation.reservation.findUnique({ where: { id: real.response.body.bookingId } }))?.paymentChannel).toBe('BOOKING');
    expect(real.response.body.salesChannel).toBeUndefined();
  }, 240_000);

  it('ADM-E2E-01 API interna: un admin lista vuelos (con flightInstanceId), lee y guarda tarifas; customer, partner y sin token no entran', async () => {
    const s = await scenario(); const admin = supabase('admin-1', 'admin', true, `${USER_SCOPES} flights:webhooks flights:admin`);
    const flights = await request(stack.server).get('/api/admin/v1/flights').query({ date: s.date, limit: 200 }).set('Authorization', admin);
    expect(flights.status).toBe(200); expect(Array.isArray(flights.body.items)).toBe(true);
    let found = flights.body.items.find((item: { flightInstanceId: string }) => item.flightInstanceId === s.flightId);
    for (let cursor = flights.body.page?.nextCursor as string | undefined; !found && cursor;) { const next = await request(stack.server).get('/api/admin/v1/flights').query({ date: s.date, limit: 200, cursor }).set('Authorization', admin); expect(next.status).toBe(200); found = next.body.items.find((item: { flightInstanceId: string }) => item.flightInstanceId === s.flightId); cursor = next.body.page?.nextCursor; }
    expect(found).toBeDefined();
    const fares = await request(stack.server).get('/api/admin/v1/fares').query({ flightInstanceId: s.flightId }).set('Authorization', admin); expect(fares.status).toBe(200); expect(fares.body.fares[0].fare).toMatchObject({ flightInstanceId: s.flightId, cabinClass: 'ECONOMY' });
    const saved = await request(stack.server).put('/api/admin/v1/fares').set('Authorization', admin).send({ flightInstanceId: s.flightId, cabinClass: 'ECONOMY', fareBrand: 'PROMO', price: { currency: 'USD', baseFare: '90.00', taxes: '10.00', total: '100.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { personalItemIncluded: true, carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { currency: 'USD', total: '40.00' } });
    expect(saved.status).toBe(200); expect(saved.body.fare).toMatchObject({ fareBrand: 'PROMO', flightInstanceId: s.flightId });
    expect((await request(stack.server).get('/api/admin/v1/fares').query({ flightInstanceId: s.flightId }).set('Authorization', admin)).body.fares).toHaveLength(2);
    for (const denied of [supabase('user-x'), supabase('booking', 'partner', true, `${USER_SCOPES} flights:webhooks flights:admin`)]) { const response = await request(stack.server).get('/api/admin/v1/flights').set('Authorization', denied); expect(response.status).toBe(403); expectSchema('ProblemDetails', response.body); }
    expect((await request(stack.server).get('/api/admin/v1/flights')).status).toBe(401);
    expect((await request(stack.server).get('/api/admin/v1/flights').set('Authorization', `Bearer ${Buffer.from('x').toString('base64url')}`)).status).toBe(401);
  }, 240_000);
});

describeReal('F12c B-1 · sin WEB_PAYMENT_MODE la web no vende (servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  beforeAll(async () => { stack = await startStack({ JWT_ISSUERS: issuers }); }, 240_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 180_000);

  it('WEB-E2E-06 con el interruptor ausente: 422 PAYMENT_NOT_AUTHORIZED con tipo web-payments-disabled, sin reserva y el hold intacto; un socio sigue vendiendo', async () => {
    const s = await stack.scenario({ sellable: 5 }); scenarios.push(s); const sub = `web-${randomUUID()}`; const auth = supabase(sub);
    try {
      const held = await holdAs(stack, s, auth); const response = await reserve(stack, auth, held);
      expect(response.status).toBe(422); expect(response.body).toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED', type: 'https://flight-platform.dev/problems/web-payments-disabled' }); expectSchema('ProblemDetails', response.body);
      expect(await stack.db.reservation.reservation.count({ where: { ownerId: sub } })).toBe(0);
      const status = await request(stack.server).get(`/api/v2/vuelos/offers/hold/${held.holdId}`).set('Authorization', auth); expect(status.status).toBe(200); expect(status.body.status).toBe('HELD');
      const partnerHeld = await hold(stack, s, s.client, 'u9'); expect((await book(stack, s, s.client, 'u9', partnerHeld)).response.status).toBe(201);
    } finally { const owned = { ownerId: sub }; await stack.db.pricing.priceLock.deleteMany({ where: owned }); await stack.db.inventory.hold.deleteMany({ where: owned }); }
  }, 240_000);
});
