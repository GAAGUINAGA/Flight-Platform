import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { buildCloudEvent, type WebhookPayload } from '../../../../../microservices/webhooks-service/src/domain/webhook';
import { expectSchema, expectV2Response, type TestClient } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, headers, hold } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const STATUS = '/vuelos/flights/{flightNumber}/status'; const PANEL = '/vuelos/operaciones/vuelos'; const AGREEMENT = '/vuelos/promociones/contrato';
const agreement = (overrides: Record<string, unknown> = {}) => ({ permite_promociones: true, porcentaje_descuento_maximo: 12, destinos_habilitados: ['Quito', 'Guayaquil'], rutas_habilitadas: ['UIO-GYE', 'GYE-UIO'], cabinas_habilitadas: ['ECONOMY'], vigencia_hasta: '2026-12-31', condiciones_combo: 'Hasta 12% en combos; no aplica en feriados.', ...overrides });

describeReal('F12a P6 · operaciones y promociones v2 (contra servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  const scenario = async (options: Parameters<Stack['scenario']>[0] = {}) => { const value = await stack.scenario(options); scenarios.push(value); return value; };
  beforeAll(async () => { stack = await startStack(); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  const auth = async (client: TestClient, scope?: string) => headers(stack, client, undefined, scope);
  const patch = async (flightNumber: string, body: object | undefined, client: TestClient, scope: string | null = 'flights:ops', key?: string) => {
    let call = request(stack.server).patch(`/api/v2/vuelos/flights/${flightNumber}/status`); if (scope !== null) call = call.set(await auth(client, scope)); if (key) call = call.set('Idempotency-Key', key);
    return body === undefined ? call : call.send(body);
  };
  const panel = async (query: Record<string, string | number>, client: TestClient, scope: string | null = 'flights:ops') => { let call = request(stack.server).get('/api/v2/vuelos/operaciones/vuelos').query(query); if (scope !== null) call = call.set(await auth(client, scope)); return call; };
  const getAgreement = async (client: TestClient, scope: string | null = 'flights:read') => { let call = request(stack.server).get('/api/v2/vuelos/promociones/contrato'); if (scope !== null) call = call.set(await auth(client, scope)); return call; };
  const putAgreement = async (body: object | undefined, client: TestClient, scope: string | null = 'flights:admin', key: string | null = randomUUID()) => { let call = request(stack.server).put('/api/v2/vuelos/promociones/contrato'); if (scope !== null) call = call.set(await auth(client, scope)); if (key) call = call.set('Idempotency-Key', key); return body === undefined ? call : call.send(body); };
  const delayed = (s: Scenario, minutes = 45) => ({ date: s.date, status: 'DELAYED', estimatedDepartureAt: new Date(s.departure.getTime() + minutes * 60_000).toISOString(), departureGate: 'A6', reason: 'Condiciones meteorológicas en GYE' });
  const deliveries = async (client: TestClient) => (await stack.db.webhooks.delivery.findMany({ where: { subscription: { ownerId: client.clientId } } })).map((row) => row.payload as unknown as WebhookPayload);
  const flightOf = async (s: Scenario) => { const rows = (await panel({ date: s.date, origin: s.origin, destination: s.destination }, s.client)).body.items as Array<Record<string, unknown> & { flightNumber: string; nextHoldExpiryAt: string; checkInOpen: boolean; alerts: unknown[] }>; return rows.find((row) => row.flightNumber === s.flightNumber); };

  describe('PATCH /vuelos/flights/{flightNumber}/status', () => {
    it('V2-P6-01 K: DELAYED con puerta y motivo responde 200 y cumple FlightStatusUpdateResponse', async () => {
      const s = await scenario(); const res = await patch(s.flightNumber, delayed(s), s.client);
      expect(res.status).toBe(200); expectV2Response('PATCH', STATUS, 200, res.body);
      expect(res.body).toMatchObject({ previousStatus: 'SCHEDULED', affectedBookings: 0, flight: { flightNumber: s.flightNumber, date: s.date, status: 'DELAYED', delayMinutes: 45 } }); expect(typeof res.body.eventId).toBe('string');
    }, 90_000);
    it('V2-P6-02 la puerta y el motivo se guardan en Operations', async () => {
      const s = await scenario(); expect((await patch(s.flightNumber, delayed(s), s.client)).status).toBe(200);
      const row = await stack.db.operations.operationalFlight.findUnique({ where: { flightInstanceId: s.flightId } }); expect(row).toMatchObject({ status: 'DELAYED', departureGate: 'A6', statusReason: 'Condiciones meteorológicas en GYE' });
    }, 90_000);
    it('V2-P6-03 flight.status_changed viaja con departureGate y reason y cumple EventFlightStatusChanged', async () => {
      const s = await scenario(); await stack.subscribe(s.client.clientId, ['flight.status_changed']);
      const res = await patch(s.flightNumber, delayed(s), s.client); expect(res.status).toBe(200);
      const sent = (await deliveries(s.client)).find((event) => event.eventType === 'flight.status_changed');
      expect(sent?.extra).toMatchObject({ flightNumber: s.flightNumber, date: s.date, previousStatus: 'SCHEDULED', newStatus: 'DELAYED', departureGate: 'A6', reason: 'Condiciones meteorológicas en GYE', delayMinutes: 45, destination: s.destination, affectedBookingIds: [] });
      expect(sent?.eventId).toBe(res.body.eventId); expectSchema('EventFlightStatusChanged', buildCloudEvent(sent!, 'gabatair'));
    }, 90_000);
    it('V2-P6-04 el socio con reservas en el vuelo recibe el evento con solo los ids de sus reservas y affectedBookings las cuenta', async () => {
      const s = await scenario(); const ops = await s.extraClient(); const other = await s.extraClient(); await stack.subscribe(s.client.clientId, ['flight.status_changed']); await stack.subscribe(other.clientId, ['flight.status_changed']);
      const held = await hold(stack, s, s.client, 'u1'); const bought = await book(stack, s, s.client, 'u1', held); expect(bought.response.status).toBe(201); const bookingId = bought.response.body.bookingId as string;
      const res = await patch(s.flightNumber, delayed(s), ops); expect(res.status).toBe(200); expect(res.body.affectedBookings).toBe(1);
      const sent = (await deliveries(s.client)).find((event) => event.eventType === 'flight.status_changed'); expect(sent?.extra).toMatchObject({ newStatus: 'DELAYED', affectedBookingIds: [bookingId] });
      expect((await deliveries(other)).filter((event) => event.eventType === 'flight.status_changed')).toHaveLength(0);
      const own = (await deliveries(ops)); expect(own).toHaveLength(0); expect(await stack.db.webhooks.event.count({ where: { ownerId: ops.clientId, eventType: 'flight.status_changed' } })).toBe(1);
    }, 150_000);
    it('V2-P6-05 una transición inválida responde 409 INVALID_STATUS_TRANSITION y no cambia nada ni emite el evento', async () => {
      const s = await scenario(); const res = await patch(s.flightNumber, { date: s.date, status: 'ARRIVED' }, s.client);
      expect(res.status).toBe(409); expect(res.body.code).toBe('INVALID_STATUS_TRANSITION'); expectV2Response('PATCH', STATUS, 409, res.body);
      expect((await stack.db.operations.operationalFlight.findUnique({ where: { flightInstanceId: s.flightId } }))?.status).toBe('SCHEDULED'); expect(await stack.db.webhooks.event.count({ where: { ownerId: s.client.clientId, eventType: 'flight.status_changed' } })).toBe(0);
    }, 90_000);
    it('V2-P6-06 desde un estado terminal ninguna transición es válida', async () => {
      const s = await scenario(); expect((await patch(s.flightNumber, { date: s.date, status: 'CANCELLED', reason: 'Prueba' }, s.client)).status).toBe(200);
      const again = await patch(s.flightNumber, { date: s.date, status: 'BOARDING' }, s.client); expect(again.status).toBe(409); expect(again.body.code).toBe('INVALID_STATUS_TRANSITION');
    }, 90_000);
    it('V2-P6-07 CANCELLED cierra la venta del vuelo como en v1', async () => {
      const s = await scenario(); const res = await patch(s.flightNumber, { date: s.date, status: 'CANCELLED', reason: 'Falla técnica' }, s.client); expect(res.status).toBe(200); expect(res.body.flight.status).toBe('CANCELLED');
      expect((await stack.db.inventory.flightInstance.findUnique({ where: { id: s.flightId } }))?.closed).toBe(true); await expect(s.search()).rejects.toThrow();
    }, 90_000);
    it('V2-P6-08 la cadena SCHEDULED → BOARDING → DEPARTED → ARRIVED se acepta paso a paso y GET status lo refleja', async () => {
      const s = await scenario(); let previous = 'SCHEDULED';
      for (const status of ['BOARDING', 'DEPARTED', 'ARRIVED']) { const res = await patch(s.flightNumber, { date: s.date, status }, s.client); expect(res.status).toBe(200); expect(res.body.previousStatus).toBe(previous); previous = status; }
      const read = await request(stack.server).get(`/api/v2/vuelos/flights/${s.flightNumber}/status`).query({ date: s.date }); expect(read.status).toBe(200); expect(read.body.status).toBe('ARRIVED');
    }, 120_000);
    it('V2-P6-09 un vuelo inexistente responde 404 y un vuelo en otra fecha también', async () => {
      const s = await scenario(); const missing = await patch('ZZ9999', { date: s.date, status: 'DELAYED' }, s.client); expect(missing.status).toBe(404); expectV2Response('PATCH', STATUS, 404, missing.body);
      expect((await patch(s.flightNumber, { date: '2030-01-01', status: 'DELAYED' }, s.client)).status).toBe(404);
    }, 90_000);
    it('V2-P6-10 con el mismo Idempotency-Key el reintento no emite un segundo evento y devuelve el mismo eventId', async () => {
      const s = await scenario(); const key = randomUUID(); const body = delayed(s); const first = await patch(s.flightNumber, body, s.client, 'flights:ops', key); const again = await patch(s.flightNumber, body, s.client, 'flights:ops', key);
      expect([first.status, again.status]).toEqual([200, 200]); expect(again.body.eventId).toBe(first.body.eventId); expect(await stack.db.webhooks.event.count({ where: { ownerId: s.client.clientId, eventType: 'flight.status_changed' } })).toBe(1);
    }, 90_000);
    it('V2-P6-11 con flights:admin en lugar de flights:ops también se acepta', async () => {
      const s = await scenario(); const res = await patch(s.flightNumber, delayed(s), s.client, 'flights:admin'); expect(res.status).toBe(200); expectV2Response('PATCH', STATUS, 200, res.body);
    }, 90_000);
    it('V2-P6-12 S: sin token responde 401', async () => {
      const s = await scenario(); const res = await patch(s.flightNumber, delayed(s), s.client, null); expect(res.status).toBe(401); expect(res.body.code).toBe('UNAUTHORIZED'); expectV2Response('PATCH', STATUS, 401, res.body);
    }, 60_000);
    it('V2-P6-13 S: con flights:read, flights:book o flights:webhooks responde 403 y no cambia el vuelo', async () => {
      const s = await scenario();
      for (const scope of ['flights:read', 'flights:book', 'flights:webhooks']) { const res = await patch(s.flightNumber, delayed(s), s.client, scope); expect(res.status).toBe(403); expect(res.body.code).toBe('FORBIDDEN'); expectV2Response('PATCH', STATUS, 403, res.body); }
      expect((await stack.db.operations.operationalFlight.findUnique({ where: { flightInstanceId: s.flightId } }))?.status).toBe('SCHEDULED');
    }, 90_000);
    it('V2-P6-14 S: una entrada inválida responde 400 (fecha, estado, hora, número de vuelo, cuerpo vacío)', async () => {
      const s = await scenario(); const bad: Array<[string, object | undefined]> = [[s.flightNumber, { status: 'DELAYED' }], [s.flightNumber, { date: s.date }], [s.flightNumber, { date: s.date, status: 'FLYING' }], [s.flightNumber, { date: '20-11-2026', status: 'DELAYED' }], [s.flightNumber, { date: s.date, status: 'DELAYED', estimatedDepartureAt: 'mañana' }], [s.flightNumber, { date: s.date, status: 'DELAYED', departureGate: 7 }], ['abc', { date: s.date, status: 'DELAYED' }], [s.flightNumber, {}]];
      for (const [flight, body] of bad) { const res = await patch(flight, body, s.client); expect(res.status).toBe(400); expectV2Response('PATCH', STATUS, 400, res.body); }
      expect((await patch(s.flightNumber, delayed(s), s.client, 'flights:ops', 'no-es-uuid')).status).toBe(400);
    }, 120_000);
    it('V2-P6-15 S: una puerta o un motivo demasiado largos responden 400 y no se guardan', async () => {
      const s = await scenario(); for (const extra of [{ departureGate: 'G'.repeat(17) }, { reason: 'x'.repeat(201) }, { departureGate: '' }]) expect((await patch(s.flightNumber, { date: s.date, status: 'DELAYED', ...extra }, s.client)).status).toBe(400);
      expect((await stack.db.operations.operationalFlight.findUnique({ where: { flightInstanceId: s.flightId } }))?.status).toBe('SCHEDULED');
    }, 90_000);
  });

  describe('GET /vuelos/operaciones/vuelos', () => {
    it('V2-P6-20 K: el panel del día cumple FlightOperationsResponse y trae el vuelo con su cabina', async () => {
      const s = await scenario(); const res = await panel({ date: s.date, origin: s.origin, destination: s.destination }, s.client);
      expect(res.status).toBe(200); expectV2Response('GET', PANEL, 200, res.body); expect(res.body).toMatchObject({ date: s.date, totalFlights: 1, nextCursor: null });
      expect(res.body.items[0]).toMatchObject({ flightNumber: s.flightNumber, origin: s.origin, destination: s.destination, status: 'SCHEDULED', aircraft: s.aircraft, totalSeats: 5, loadFactor: 0, activeHolds: 0, nextHoldExpiryAt: null, cabins: [{ cabinClass: 'ECONOMY', totalSeats: 5, seatsByStatus: { AVAILABLE: 5, HELD: 0, BOOKED: 0, TICKETED: 0, CHECKED_IN: 0, BOARDED: 0 } }] });
    }, 90_000);
    it('V2-P6-21 un hold activo cuenta como HELD con su próximo vencimiento y un hold liberado vuelve a AVAILABLE', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); const row = await flightOf(s);
      expect(row).toMatchObject({ activeHolds: 1, loadFactor: 20, cabins: [{ seatsByStatus: { AVAILABLE: 4, HELD: 1, TICKETED: 0 } }] }); expect(Date.parse(row!.nextHoldExpiryAt)).toBeGreaterThan(Date.now());
      const released = await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, s.client, 'u1')); expect([200, 204]).toContain(released.status);
      expect(await flightOf(s)).toMatchObject({ activeHolds: 0, nextHoldExpiryAt: null, cabins: [{ seatsByStatus: { AVAILABLE: 5, HELD: 0 } }] });
    }, 120_000);
    it('V2-P6-22 una reserva emitida cuenta como TICKETED (la emisión v2 es inmediata) y sube el factor de ocupación', async () => {
      const s = await scenario(); const held = await hold(stack, s, s.client, 'u1'); expect((await book(stack, s, s.client, 'u1', held)).response.status).toBe(201);
      expect(await flightOf(s)).toMatchObject({ activeHolds: 0, loadFactor: 20, cabins: [{ seatsByStatus: { AVAILABLE: 4, HELD: 0, TICKETED: 1 } }] });
    }, 150_000);
    it('V2-P6-23 el filtro status devuelve solo los vuelos en ese estado y el estado cambia tras el PATCH', async () => {
      const s = await scenario(); const q = { date: s.date, origin: s.origin, destination: s.destination };
      expect((await panel({ ...q, status: 'DELAYED' }, s.client)).body.totalFlights).toBe(0); expect((await patch(s.flightNumber, delayed(s), s.client)).status).toBe(200);
      const delayedRows = await panel({ ...q, status: 'DELAYED' }, s.client); expect(delayedRows.body.totalFlights).toBe(1); expect(delayedRows.body.items[0].status).toBe('DELAYED'); expect((await panel({ ...q, status: 'SCHEDULED' }, s.client)).body.totalFlights).toBe(0);
    }, 120_000);
    it('V2-P6-24 los filtros origin y destination excluyen los otros vuelos de la fecha', async () => {
      const s = await scenario(); expect((await panel({ date: s.date, origin: s.origin, destination: s.destination }, s.client)).body.totalFlights).toBe(1);
      expect((await panel({ date: s.date, origin: s.origin, destination: 'ZZZ' }, s.client)).body.totalFlights).toBe(0); expect((await panel({ date: '2030-01-01', origin: s.origin }, s.client)).body).toMatchObject({ totalFlights: 0, items: [], nextCursor: null });
    }, 90_000);
    it('V2-P6-25 la paginación con limit y cursor recorre los vuelos sin repetir ninguno', async () => {
      const a = await scenario(); const b = await scenario({ origin: a.origin, destination: a.destination }); const q = { date: a.date, origin: a.origin, destination: a.destination };
      const first = await panel({ ...q, limit: 1 }, a.client); expect(first.status).toBe(200); expect(first.body.items).toHaveLength(1); expect(first.body.totalFlights).toBe(2); expect(typeof first.body.nextCursor).toBe('string'); expectV2Response('GET', PANEL, 200, first.body);
      const second = await panel({ ...q, limit: 1, cursor: first.body.nextCursor }, a.client); expect(second.body.items).toHaveLength(1); expect(second.body.nextCursor).toBeNull();
      expect([first.body.items[0].flightNumber, second.body.items[0].flightNumber].sort()).toEqual([a.flightNumber, b.flightNumber].sort()); expect((await panel({ ...q, cursor: randomUUID() }, a.client)).status).toBe(400);
    }, 120_000);
    it('V2-P6-26 las alertas reportan poca disponibilidad, demora y cancelación con el código y la severidad del contrato', async () => {
      const s = await scenario(); const base = await flightOf(s); expect(base!.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LOW_AVAILABILITY', severity: 'WARNING' })]));
      await patch(s.flightNumber, delayed(s), s.client); expect((await flightOf(s))!.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DELAYED', severity: 'WARNING' })]));
      await patch(s.flightNumber, { date: s.date, status: 'CANCELLED' }, s.client); const cancelled = await flightOf(s); expect(cancelled!.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CANCELLED', severity: 'CRITICAL' })])); expect(cancelled!.checkInOpen).toBe(false);
    }, 120_000);
    it('V2-P6-27 checkInOpen es verdadero dentro de la ventana de check-in y falso fuera de ella', async () => {
      const soon = await scenario({ hoursAhead: 10 }); const far = await scenario({ hoursAhead: 5 * 24 });
      const near = await flightOf(soon); expect(near?.checkInOpen).toBe(true); expect(near?.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CHECKIN_OPEN', severity: 'INFO' })])); expect((await flightOf(far))?.checkInOpen).toBe(false);
    }, 120_000);
    it('V2-P6-28 S: sin token responde 401', async () => {
      const res = await panel({ date: '2026-11-20' }, { clientId: 'x', secret: 'y' }, null); expect(res.status).toBe(401); expectV2Response('GET', PANEL, 401, res.body);
    }, 60_000);
    it('V2-P6-29 S: con flights:read responde 403', async () => {
      const s = await scenario(); const res = await panel({ date: s.date }, s.client, 'flights:read'); expect(res.status).toBe(403); expectV2Response('GET', PANEL, 403, res.body);
    }, 60_000);
    it('V2-P6-30 S: una entrada inválida responde 400 (sin fecha, fecha mala, IATA en minúsculas, estado, límite)', async () => {
      const s = await scenario(); const bad: Array<Record<string, string | number>> = [{}, { date: 'hoy' }, { date: s.date, origin: 'uio' }, { date: s.date, destination: 'GYEX' }, { date: s.date, status: 'FLYING' }, { date: s.date, limit: 0 }, { date: s.date, limit: 51 }, { date: s.date, limit: 'muchos' }];
      for (const query of bad) { const res = await panel(query, s.client); expect(res.status).toBe(400); expectV2Response('GET', PANEL, 400, res.body); }
    }, 120_000);
    it('V2-P6-31 con flights:admin también se acepta', async () => {
      const s = await scenario(); const res = await panel({ date: s.date, origin: s.origin, destination: s.destination }, s.client, 'flights:admin'); expect(res.status).toBe(200); expect(res.body.totalFlights).toBe(1);
    }, 60_000);
  });

  describe('GET y PUT /vuelos/promociones/contrato', () => {
    // Es el primero del bloque: el acuerdo es único (global) y aún no se ha registrado ninguno.
    it('V2-P6-41 el GET sin acuerdo registrado responde 404', async () => {
      const client = await stack.newClient(); const res = await getAgreement(client); expect(res.status).toBe(404); expect(res.body.code).toBe('NOT_FOUND'); expectV2Response('GET', AGREEMENT, 404, res.body);
    }, 60_000);
    it('V2-P6-40 K: el admin registra el acuerdo (200) y un socio con solo flights:read lo lee completo y cumple ContratoPromocionesResponse', async () => {
      const admin = await stack.newClient(); const partner = await stack.newClient(); const put = await putAgreement(agreement(), admin);
      expect(put.status).toBe(200); expectV2Response('PUT', AGREEMENT, 200, put.body); expect(put.body).toMatchObject({ success: true, contrato: { proveedor_codigo: 'NODE_VUE_GABATAIR', nombre_socio: 'GabatAIR', vertical: 'VUELOS', ...agreement() } });
      const got = await getAgreement(partner); expect(got.status).toBe(200); expectV2Response('GET', AGREEMENT, 200, got.body); expect(got.body).toMatchObject(agreement()); expect(Date.parse(got.body.actualizado_en)).not.toBeNaN();
    }, 60_000);
    it('V2-P6-42 un PUT con solo los campos obligatorios se acepta y los listas quedan vacías', async () => {
      const client = await stack.newClient(); const put = await putAgreement({ permite_promociones: false, porcentaje_descuento_maximo: 0 }, client); expect(put.status).toBe(200); expectV2Response('PUT', AGREEMENT, 200, put.body);
      expect((await getAgreement(client)).body).toMatchObject({ permite_promociones: false, porcentaje_descuento_maximo: 0, destinos_habilitados: [], rutas_habilitadas: [], cabinas_habilitadas: [] });
    }, 60_000);
    it('V2-P6-43 el PUT reemplaza el acuerdo anterior', async () => {
      const client = await stack.newClient(); await putAgreement(agreement(), client); await putAgreement(agreement({ porcentaje_descuento_maximo: 5, rutas_habilitadas: ['UIO-CUE'], condiciones_combo: undefined }), client);
      const got = await getAgreement(client); expect(got.body).toMatchObject({ porcentaje_descuento_maximo: 5, rutas_habilitadas: ['UIO-CUE'] }); expect(got.body).not.toHaveProperty('condiciones_combo');
    }, 60_000);
    it('V2-P6-44 el reintento con la misma Idempotency-Key responde 200 Idempotent-Replayed con el mismo cuerpo; con otro cuerpo, 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const client = await stack.newClient(); const key = randomUUID(); const first = await putAgreement(agreement(), client, 'flights:admin', key); const again = await putAgreement(agreement(), client, 'flights:admin', key);
      expect([first.status, again.status]).toEqual([200, 200]); expect(again.headers['idempotent-replayed']).toBe('true'); expect(again.body).toEqual(first.body);
      const other = await putAgreement(agreement({ porcentaje_descuento_maximo: 3 }), client, 'flights:admin', key); expect(other.status).toBe(409); expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED'); expect((await getAgreement(client)).body.porcentaje_descuento_maximo).toBe(12);
    }, 60_000);
    it('V2-P6-45 un descuento fuera de 0–100 responde 422 PROMOTION_DISCOUNT_OUT_OF_RANGE y no cambia el acuerdo', async () => {
      const client = await stack.newClient(); await putAgreement(agreement(), client);
      for (const value of [100.01, 101, -1, -0.5]) { const res = await putAgreement(agreement({ porcentaje_descuento_maximo: value }), client); expect(res.status).toBe(422); expect(res.body.code).toBe('PROMOTION_DISCOUNT_OUT_OF_RANGE'); expectV2Response('PUT', AGREEMENT, 422, res.body); }
      for (const value of [0, 100]) expect((await putAgreement(agreement({ porcentaje_descuento_maximo: value }), client)).status).toBe(200);
    }, 90_000);
    it('V2-P6-46 el acuerdo es único: lo que registra un admin lo ven todos los socios y el último PUT gana', async () => {
      const a = await stack.newClient(); const b = await stack.newClient(); await putAgreement(agreement({ porcentaje_descuento_maximo: 9 }), a);
      expect((await getAgreement(b)).body.porcentaje_descuento_maximo).toBe(9); await putAgreement(agreement({ porcentaje_descuento_maximo: 7 }), b); expect((await getAgreement(a)).body.porcentaje_descuento_maximo).toBe(7);
    }, 60_000);
    it('V2-P6-46b un socio con solo flights:read (sin flights:admin) no puede hacer PUT: 403 y el acuerdo no cambia', async () => {
      const partner = await stack.newClient(); await putAgreement(agreement({ porcentaje_descuento_maximo: 6 }), partner); const denied = await putAgreement(agreement({ porcentaje_descuento_maximo: 1 }), partner, 'flights:read');
      expect(denied.status).toBe(403); expect((await getAgreement(partner)).body.porcentaje_descuento_maximo).toBe(6);
    }, 60_000);
    it('V2-P6-47 S: sin token, GET y PUT responden 401', async () => {
      const client = await stack.newClient(); const get = await getAgreement(client, null); const put = await putAgreement(agreement(), client, null);
      expect([get.status, put.status]).toEqual([401, 401]); expectV2Response('GET', AGREEMENT, 401, get.body); expectV2Response('PUT', AGREEMENT, 401, put.body);
    }, 60_000);
    it('V2-P6-48 S: el PUT con flights:read o flights:ops responde 403 y no guarda nada; el GET sin flights:read también', async () => {
      const client = await stack.newClient();
      for (const scope of ['flights:read', 'flights:ops', 'flights:book']) { const res = await putAgreement(agreement(), client, scope); expect(res.status).toBe(403); expect(res.body.code).toBe('FORBIDDEN'); expectV2Response('PUT', AGREEMENT, 403, res.body); }
      const denied = await getAgreement(client, 'flights:ops'); expect(denied.status).toBe(403); expectV2Response('GET', AGREEMENT, 403, denied.body);
    }, 90_000);
    it('V2-P6-49 S: una entrada inválida responde 400 (sin cuerpo, tipos, rutas, cabinas, fecha, sin Idempotency-Key)', async () => {
      const client = await stack.newClient(); const bad: object[] = [{}, { permite_promociones: true }, { porcentaje_descuento_maximo: 10 }, agreement({ permite_promociones: 'si' }), agreement({ porcentaje_descuento_maximo: '10' }), agreement({ rutas_habilitadas: ['UIO-GYEX'] }), agreement({ rutas_habilitadas: ['uio-gye'] }), agreement({ cabinas_habilitadas: ['PLATINUM'] }), agreement({ vigencia_hasta: '31/12/2026' }), agreement({ destinos_habilitados: 'Quito' })];
      for (const body of bad) { const res = await putAgreement(body, client); expect(res.status).toBe(400); expectV2Response('PUT', AGREEMENT, 400, res.body); }
      expect((await putAgreement(agreement(), client, 'flights:admin', null)).status).toBe(400); expect((await putAgreement(agreement(), client, 'flights:admin', 'no-es-uuid')).status).toBe(400);
    }, 120_000);
  });

  describe('matriz rol × operación (P6)', () => {
    type Cell = [string, string, string | null, number]; const SCOPES = { anonymous: null, lector: 'flights:read', operador: 'flights:ops', admin: 'flights:admin' } as const;
    const cells: Cell[] = [
      ['PATCH status', 'anonymous', null, 401], ['PATCH status', 'lector', SCOPES.lector, 403], ['PATCH status', 'operador', SCOPES.operador, 200], ['PATCH status', 'admin', SCOPES.admin, 200],
      ['GET operaciones/vuelos', 'anonymous', null, 401], ['GET operaciones/vuelos', 'lector', SCOPES.lector, 403], ['GET operaciones/vuelos', 'operador', SCOPES.operador, 200], ['GET operaciones/vuelos', 'admin', SCOPES.admin, 200],
      ['GET promociones/contrato', 'anonymous', null, 401], ['GET promociones/contrato', 'lector', SCOPES.lector, 200], ['GET promociones/contrato', 'operador', SCOPES.operador, 403], ['GET promociones/contrato', 'admin', SCOPES.admin, 403],
      ['PUT promociones/contrato', 'anonymous', null, 401], ['PUT promociones/contrato', 'lector', SCOPES.lector, 403], ['PUT promociones/contrato', 'operador', SCOPES.operador, 403], ['PUT promociones/contrato', 'admin', SCOPES.admin, 200]
    ];
    it.each(cells)('V2-P6-MX %s · %s → %i', async (operation, _role, scope, expected) => {
      const s = await scenario(); let status: number;
      if (operation === 'PATCH status') status = (await patch(s.flightNumber, { date: s.date, status: 'BOARDING' }, s.client, scope)).status;
      else if (operation === 'GET operaciones/vuelos') status = (await panel({ date: s.date, origin: s.origin, destination: s.destination }, s.client, scope)).status;
      else if (operation === 'GET promociones/contrato') { await putAgreement(agreement(), s.client); status = (await getAgreement(s.client, scope)).status; }
      else status = (await putAgreement(agreement(), s.client, scope)).status;
      expect(status).toBe(expected);
    }, 90_000);
  });
});
