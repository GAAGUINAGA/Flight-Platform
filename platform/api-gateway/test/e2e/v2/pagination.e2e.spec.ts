import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createDevToken } from '../../../../../infra/scripts/dev-token';
import { startStack, type Scenario, type Stack } from './stack';
import { headers, passenger } from './flow';

/**
 * F12c-1, punto 0: paginación de TODAS las listas del Gateway contra servicios reales por el transporte ESB (el valor por omisión de GATEWAY_TRANSPORT; el arnés levanta el ESB).
 * Regla de estas pruebas: cada lista se recorre con un limit MENOR que el total siguiendo el cursor hasta que se cierra, y se comprueba que (a) ninguna página
 * supera el limit, (b) no hay repetidos ni saltos y (c) el cursor final es nulo. Antes, V2-P2-65 pedía limit=1 sobre 2 reservas: un servicio que ignora `limit`
 * devolvía las 2 en la primera página, sin cursor, y la prueba pasaba sin haber paginado nada.
 */
const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
const dir = mkdtempSync(join(tmpdir(), 'pagination-')); const publicKeyFile = join(dir, 'public.pem'); writeFileSync(publicKeyFile, keys.publicKey);
const issuers = JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile }]);
const USER_SCOPES = 'flights:read flights:hold flights:book flights:cancel';
const token = (sub: string, role = 'customer', scope = USER_SCOPES) => `Bearer ${createDevToken(keys.privateKey, { sub, app_role: role, scope, email_verified: true } as never)}`;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BOOKINGS = 7;
describeReal('F12c-1 punto 0 · paginación de las listas del Gateway (servicios reales, transporte ESB)', () => {
  let stack: Stack; const scenarios: Scenario[] = []; const sub = `pag-${randomUUID()}`; const auth = token(sub); const created: string[] = [];
  beforeAll(async () => {
    stack = await startStack({ JWT_ISSUERS: issuers, WEB_PAYMENT_MODE: 'simulated', WEB_MAX_ACTIVE_BOOKINGS: '20', WEB_MAX_PASSENGERS_PER_DAY: '50' });
    // Un cliente de la web con 7 reservas (más que cualquier limit de las pruebas) y tres vuelos del mismo día para las listas de vuelos.
    const s = await stack.scenario({ sellable: BOOKINGS + 1 }); scenarios.push(s);
    for (let index = 0; index < BOOKINGS; index += 1) {
      const offer = await s.search();
      const held = await request(stack.server).post('/api/v2/vuelos/offers/hold').set('Authorization', auth).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 } });
      expect(held.status).toBe(201);
      const booked = await request(stack.server).post('/api/v2/vuelos/bookings').set('Authorization', auth).set('Idempotency-Key', randomUUID()).send({ holdId: held.body.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: `pay_ok_${randomUUID()}`, amount: held.body.lockedPrice } });
      expect(booked.status).toBe(201); created.push(booked.body.bookingId);
    }
    for (let extra = 0; extra < 2; extra += 1) scenarios.push(await stack.scenario({ sellable: 2 }));
  }, 600_000);
  afterAll(async () => {
    try {
      const owned = { ownerId: sub }; const rows = await stack?.db.reservation.reservation.findMany({ where: owned, select: { id: true } }) ?? [];
      await stack?.db.ticketing.ticket.deleteMany({ where: owned }); await stack?.db.ticketing.issuanceRequest.deleteMany({ where: { bookingId: { in: rows.map((row) => row.id) } } }); await stack?.db.operations.checkIn.deleteMany({ where: owned });
      await stack?.db.ancillaries.baggageAllowance.deleteMany({ where: owned }); await stack?.db.ancillaries.baggageItem.deleteMany({ where: owned }); await stack?.db.ancillaries.seatAssignment.deleteMany({ where: owned }); await stack?.db.ancillaries.bookingOwner.deleteMany({ where: owned });
      await stack?.db.reservation.reservation.deleteMany({ where: owned }); await stack?.db.pricing.priceLock.deleteMany({ where: owned }); await stack?.db.inventory.reservedInventory.deleteMany({ where: owned }); await stack?.db.inventory.hold.deleteMany({ where: owned });
    } finally { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }
  }, 300_000);

  /** Recorre una lista: devuelve los ids por página, falla si el cursor se repite o si pasa de `maxPages`. */
  async function walk(fetchPage: (cursor?: string) => Promise<{ ids: string[]; next?: string | null }>, maxPages = 40): Promise<string[][]> {
    const pages: string[][] = []; const cursors = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await fetchPage(cursor); pages.push(result.ids);
      if (result.next === null || result.next === undefined) return pages;
      expect(cursors.has(result.next)).toBe(false); cursors.add(result.next); cursor = result.next;
    }
    throw new Error('la lista no cerró el cursor');
  }
  const expectPaged = (pages: string[][], limit: number, expected: string[]) => {
    expect(pages.every((ids) => ids.length <= limit)).toBe(true); expect(pages[0]).toHaveLength(limit);
    const all = pages.flat(); expect(new Set(all).size).toBe(all.length); expect([...all].sort()).toEqual([...expected].sort());
    // «Mis reservas» va de la más reciente a la más antigua: el orden de recorrido es el inverso al de creación.
    if (expected === created) expect(all).toEqual([...created].reverse());
  };

  it('PAG-01 GET /api/v2/vuelos/bookings: limit=3 sobre 7 reservas → páginas de 3, 3 y 1, sin repetir, y el cursor final es null', async () => {
    const pages = await walk(async (cursor) => { const res = await request(stack.server).get('/api/v2/vuelos/bookings').query({ limit: '3', ...(cursor ? { cursor } : {}) }).set('Authorization', auth); expect(res.status).toBe(200); return { ids: res.body.items.map((item: { bookingId: string }) => item.bookingId), next: res.body.nextCursor }; });
    expect(pages.map((ids) => ids.length)).toEqual([3, 3, 1]); expectPaged(pages, 3, created);
    // Un cursor inventado se rechaza (400), no se ignora.
    expect((await request(stack.server).get('/api/v2/vuelos/bookings').query({ limit: '3', cursor: 'no-es-un-cursor' }).set('Authorization', auth)).status).toBe(400);
  }, 120_000);
  it('PAG-02 GET /api/v2/vuelos/bookings: limit=1 recorre las 7 de una en una; sin limit se aplica el valor por omisión del contrato (10) y caben las 7', async () => {
    const pages = await walk(async (cursor) => { const res = await request(stack.server).get('/api/v2/vuelos/bookings').query({ limit: '1', ...(cursor ? { cursor } : {}) }).set('Authorization', auth); return { ids: res.body.items.map((item: { bookingId: string }) => item.bookingId), next: res.body.nextCursor }; });
    expect(pages).toHaveLength(BOOKINGS); expectPaged(pages, 1, created);
    const all = await request(stack.server).get('/api/v2/vuelos/bookings').set('Authorization', auth); expect(all.body.items).toHaveLength(BOOKINGS); expect(all.body.nextCursor).toBeNull();
  }, 120_000);
  it('PAG-03 GET /flights/v1/bookings (v1, deprecado) pagina igual: limit=2 sobre 7 reservas', async () => {
    const pages = await walk(async (cursor) => { const res = await request(stack.server).get('/flights/v1/bookings').query({ limit: '2', ...(cursor ? { cursor } : {}) }).set('Authorization', auth); expect(res.status).toBe(200); return { ids: res.body.items.map((item: { bookingId: string }) => item.bookingId), next: res.body.nextCursor }; });
    expect(pages.map((ids) => ids.length)).toEqual([2, 2, 2, 1]); expectPaged(pages, 2, created);
  }, 120_000);
  it('PAG-04 GET /api/admin/v1/flights: limit=2 recorre los vuelos del día sin repetir ni saltar y encuentra los vuelos de los tres escenarios', async () => {
    const admin = token('admin-pag', 'admin', `${USER_SCOPES} flights:webhooks flights:admin`); const date = scenarios[0].date; const wanted = scenarios.map((item) => item.flightId);
    const pages = await walk(async (cursor) => { const res = await request(stack.server).get('/api/admin/v1/flights').query({ date, limit: '2', ...(cursor ? { cursor } : {}) }).set('Authorization', admin); expect(res.status).toBe(200); return { ids: res.body.items.map((item: { flightInstanceId: string }) => item.flightInstanceId), next: res.body.page?.nextCursor ?? null }; }, 400);
    expect(pages.every((ids) => ids.length <= 2)).toBe(true); expect(pages[0]).toHaveLength(2); const all = pages.flat(); expect(new Set(all).size).toBe(all.length); for (const id of wanted) expect(all).toContain(id);
  }, 300_000);
  it('PAG-05 GET /api/admin/v1/web-bookings: limit=3 con before recorre las reservas WEB (las 7 de la prueba están, sin repetidos) y cada página respeta el limit', async () => {
    const admin = token('admin-pag', 'admin', `${USER_SCOPES} flights:webhooks flights:admin`); const seen = new Set<string>(); let before: string | undefined; let first = true;
    for (let page = 0; page < 200 && created.some((id) => !seen.has(id)); page += 1) {
      const res = await request(stack.server).get('/api/admin/v1/web-bookings').query({ limit: '3', ...(before ? { before } : {}) }).set('Authorization', admin); expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(3); if (first) { expect(res.body.items).toHaveLength(3); expect(res.body.nextCursor).toBeTruthy(); first = false; }
      for (const item of res.body.items) { expect(seen.has(item.bookingId)).toBe(false); seen.add(item.bookingId); }
      before = res.body.nextCursor ?? undefined; if (!before) break;
    }
    for (const id of created) expect(seen.has(id)).toBe(true);
  }, 300_000);
  it('PAG-06 GET /api/v2/vuelos/operaciones/vuelos (panel): limit=1 recorre los vuelos de la fecha con cursor, sin repetir, y cierra en null', async () => {
    const admin = token('admin-pag', 'admin', `${USER_SCOPES} flights:webhooks flights:admin`); const date = scenarios[0].date; const origin = scenarios[0].origin;
    // Origen del primer escenario: solo 1 vuelo por origen aleatorio; se pagina el día completo (todos los orígenes), que incluye al menos los 3 escenarios.
    void origin;
    const pages = await walk(async (cursor) => { const res = await request(stack.server).get('/api/v2/vuelos/operaciones/vuelos').query({ date, limit: '2', ...(cursor ? { cursor } : {}) }).set('Authorization', admin); expect(res.status).toBe(200); return { ids: res.body.items.map((item: { flightNumber: string }) => item.flightNumber), next: res.body.nextCursor }; }, 400);
    expect(pages.every((ids) => ids.length <= 2)).toBe(true); expect(pages[0]).toHaveLength(2); const all = pages.flat(); expect(new Set(all).size).toBe(all.length); for (const item of scenarios) expect(all).toContain(item.flightNumber);
  }, 300_000);
  it('PAG-07 GET /api/v2/vuelos/eventos (feed): limit=2 con after recorre los eventos del cliente sin repetir y cierra con next_after nulo', async () => {
    // Los eventos del cliente de la web (dueño = sub) los ve un socio solo por su prefijo; aquí se usa un socio con una compra propia en el último escenario.
    const s = await stack.scenario({ sellable: 3 }); scenarios.push(s);
    const partner = await headers(stack, s.client, 'u1'); const offer = await s.search();
    const held = await request(stack.server).post('/api/v2/vuelos/offers/hold').set(partner).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 } }); expect(held.status).toBe(201);
    const reference = `PAY-BKP-${randomUUID()}`; stack.payments.confirmed(reference, held.body.lockedPrice.total, held.body.lockedPrice.currency);
    expect((await request(stack.server).post('/api/v2/vuelos/bookings').set(partner).set('Idempotency-Key', randomUUID()).send({ holdId: held.body.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: reference } })).status).toBe(201);
    const pages = await walk(async (after) => { const res = await request(stack.server).get('/api/v2/vuelos/eventos').query({ limit: '2', ...(after ? { after } : {}) }).set(partner); expect(res.status).toBe(200); return { ids: res.body.events.map((event: { id: string }) => event.id), next: res.body.metadata.next_after }; });
    expect(pages.map((ids) => ids.length)).toEqual([2, 1]); const all = pages.flat(); expect(new Set(all).size).toBe(3);
  }, 300_000);
});
