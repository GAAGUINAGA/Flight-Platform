import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createEsbApp } from '../../src/app';
import { FakeInvoker, FakeProbe, KEY, MemoryLogger, grpcError, testConfig, type InvokeCall } from './fakes';

const URL = '/internal/v1/operations';
let app: INestApplication; let invoker: FakeInvoker; let logger: MemoryLogger; let probe: FakeProbe;
let behavior: (call: InvokeCall) => unknown = () => ({ ok: true });

beforeAll(async () => {
  invoker = new FakeInvoker((call) => behavior(call)); logger = new MemoryLogger(); probe = new FakeProbe();
  app = await createEsbApp(testConfig(), { invoker, logger, probe });
});
afterAll(async () => { await app?.close(); });

const post = (operation: string, body: unknown = { input: {} }, headers: Record<string, string> = { 'x-internal-key': KEY }) => {
  let call = request(app.getHttpServer()).post(`${URL}/${operation}`);
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
  return call.send(body as object);
};

describe('ESB-HTTP: conectividad', () => {
  it('ESB-HTTP-01: sin llave interna responde 401 y no llega a la mediación ni a ningún servicio', async () => {
    invoker.calls.length = 0; logger.entries.length = 0;
    const response = await post('vuelos.buscar-ofertas', { input: {} }, {});
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ ok: false, error: { source: 'esb', grpcCode: 16, grpcStatus: 'UNAUTHENTICATED' } });
    expect(invoker.calls).toHaveLength(0);
    expect(logger.entries).toHaveLength(0);
  });

  it('ESB-HTTP-02: con llave errónea responde 401, incluso con una operación inexistente o un cuerpo inválido', async () => {
    invoker.calls.length = 0;
    for (const [operation, body] of [['vuelos.buscar-ofertas', { input: {} }], ['no.existe', { input: {} }], ['vuelos.buscar-ofertas', { raro: true }]] as const) {
      const response = await post(operation, body, { 'x-internal-key': `${KEY}x` });
      expect(response.status).toBe(401);
    }
    expect(invoker.calls).toHaveLength(0);
  });

  it('ESB-HTTP-03: la llave se compara aunque tenga otro largo y una llave vacía no pasa', async () => {
    expect((await post('vuelos.buscar-ofertas', { input: {} }, { 'x-internal-key': '' })).status).toBe(401);
    expect((await post('vuelos.buscar-ofertas', { input: {} }, { 'x-internal-key': 'a' })).status).toBe(401);
  });

  it('ESB-HTTP-04: con llave ejecuta la operación y devuelve {ok, result, correlationId}', async () => {
    behavior = () => ({ totalOffers: 0, offers: [] });
    const response = await post('vuelos.buscar-ofertas', { input: { legs: [] } }, { 'x-internal-key': KEY, 'x-correlation-id': 'corr-123' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, result: { totalOffers: 0, offers: [] }, correlationId: 'corr-123' });
    expect(response.header['x-correlation-id']).toBe('corr-123');
  });

  it('ESB-HTTP-05: reenvía al servicio el mensaje, la correlación y la identidad sin interpretarlos', async () => {
    invoker.calls.length = 0; behavior = () => ({});
    await post('reservas.obtener', { input: { bookingId: 'b-1' } }, { 'x-internal-key': KEY, 'x-correlation-id': 'corr-9', 'x-owner-id': 'user-7', 'x-role': 'customer' });
    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0]).toMatchObject({ service: 'reservation', method: 'getReservation', input: { bookingId: 'b-1' }, context: { correlationId: 'corr-9', ownerId: 'user-7', role: 'customer' } });
  });

  it('ESB-HTTP-06: sin X-Correlation-Id genera una y la devuelve; una inválida se reemplaza', async () => {
    const generated = await post('vuelos.buscar-ofertas');
    expect(generated.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    const replaced = await post('vuelos.buscar-ofertas', { input: {} }, { 'x-internal-key': KEY, 'x-correlation-id': 'con espacios' });
    expect(replaced.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ESB-HTTP-07: operación inexistente responde 404 UNIMPLEMENTED del ESB', async () => {
    const response = await post('vuelos.no-existe');
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ source: 'esb', grpcCode: 12 });
  });

  it('ESB-HTTP-08: sobre inválido (sin input, input no objeto o campos extra) responde 400 y no llama al servicio', async () => {
    invoker.calls.length = 0;
    for (const body of [{}, { input: 'x' }, { input: [] }, { input: {}, extra: 1 }, [] ]) {
      const response = await post('vuelos.buscar-ofertas', body);
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ source: 'esb', grpcCode: 3 });
    }
    expect(invoker.calls).toHaveLength(0);
  });

  it('ESB-HTTP-09: JSON mal formado responde 400 y un cuerpo mayor al máximo responde 413', async () => {
    const malformed = await request(app.getHttpServer()).post(`${URL}/vuelos.buscar-ofertas`).set('x-internal-key', KEY).set('content-type', 'application/json').send('{"input":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.grpcCode).toBe(3);
    const big = await post('vuelos.buscar-ofertas', { input: { blob: 'x'.repeat(5000) } });
    expect(big.status).toBe(413);
    expect(big.body.ok).toBe(false);
  });

  it('ESB-HTTP-10: X-Deadline-Ms inválido responde 400; válido se acota al máximo del ESB', async () => {
    expect((await post('vuelos.buscar-ofertas', { input: {} }, { 'x-internal-key': KEY, 'x-deadline-ms': 'abc' })).status).toBe(400);
    invoker.calls.length = 0; behavior = () => ({});
    const before = Date.now();
    await post('vuelos.buscar-ofertas', { input: {} }, { 'x-internal-key': KEY, 'x-deadline-ms': '999999' });
    expect(invoker.calls[0].deadlineAt.getTime() - before).toBeLessThanOrEqual(30_100);
    await post('vuelos.buscar-ofertas', { input: {} }, { 'x-internal-key': KEY, 'x-deadline-ms': '1500' });
    expect(invoker.calls[1].deadlineAt.getTime() - Date.now()).toBeLessThanOrEqual(1_500);
  });

  it('ESB-HTTP-11: sin plazo pedido, las operaciones orquestadas reciben 30 s y el resto 5 s', async () => {
    invoker.calls.length = 0; behavior = () => ({});
    await post('reservas.crear'); await post('reservas.obtener');
    const created = invoker.calls[0].deadlineAt.getTime() - Date.now(); const read = invoker.calls[1].deadlineAt.getTime() - Date.now();
    expect(created).toBeGreaterThan(25_000); expect(created).toBeLessThanOrEqual(30_000);
    expect(read).toBeGreaterThan(3_000); expect(read).toBeLessThanOrEqual(5_000);
  });

  it('ESB-HTTP-12: GET /health es público; GET /health/deps exige la llave', async () => {
    expect((await request(app.getHttpServer()).get('/health')).body).toEqual({ status: 'ok' });
    expect((await request(app.getHttpServer()).get('/health/deps')).status).toBe(401);
    const deps = await request(app.getHttpServer()).get('/health/deps').set('x-internal-key', KEY);
    expect(deps.status).toBe(200);
    expect(deps.body.dependencias).toHaveLength(7);
  });

  it('ESB-HTTP-13: cerrar la app cierra los clientes de los servicios (las suites terminan solas)', async () => {
    const local = new FakeInvoker(); const instance = await createEsbApp(testConfig(), { invoker: local, logger: new MemoryLogger(), probe: new FakeProbe() });
    await instance.close();
    expect(local.closed).toBeGreaterThanOrEqual(1);
  });
});

describe('ESB-ROUTE: enrutador y traducción de errores', () => {
  it('ESB-ROUTE-01: un error de dominio llega con su código gRPC y su código del catálogo, sin mensaje interno', async () => {
    behavior = () => grpcError(9, 'SEAT_TAKEN');
    const response = await post('postventa.cambiar-asientos');
    expect(response.status).toBe(422);
    expect(response.body.error).toEqual({ source: 'service', grpcCode: 9, grpcStatus: 'FAILED_PRECONDITION', catalogCode: 'SEAT_TAKEN' });
    expect(JSON.stringify(response.body)).not.toContain('internal detail');
  });

  it('ESB-ROUTE-02: servicio caído → 503 con UNAVAILABLE; plazo vencido → 504 con DEADLINE_EXCEEDED', async () => {
    behavior = () => grpcError(14);
    const down = await post('vuelos.buscar-ofertas');
    expect(down.status).toBe(503); expect(down.body.error).toMatchObject({ source: 'service', grpcCode: 14 });
    behavior = () => grpcError(4);
    const slow = await post('vuelos.buscar-ofertas');
    expect(slow.status).toBe(504); expect(slow.body.error).toMatchObject({ source: 'service', grpcCode: 4 });
  });

  it('ESB-ROUTE-03: NOT_FOUND, PERMISSION_DENIED y UNAUTHENTICATED del servicio conservan su código', async () => {
    for (const [code, http] of [[5, 404], [7, 403], [16, 401]] as const) {
      behavior = () => grpcError(code, 'X_CODE');
      const response = await post('reservas.obtener');
      expect(response.status).toBe(http); expect(response.body.error).toMatchObject({ source: 'service', grpcCode: code });
    }
  });

  it('ESB-ROUTE-04: una falla que no es gRPC es INTERNAL del ESB, sin detalles', async () => {
    behavior = () => new Error('stack with /secret/path');
    const response = await post('reservas.obtener');
    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({ source: 'esb', grpcCode: 13, catalogCode: null });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('ESB-ROUTE-05: cada dominio enruta al servicio y método que dice el catálogo', async () => {
    const cases: Array<[string, string, string]> = [
      ['vuelos.buscar-ofertas', 'pricing', 'searchOffers'], ['vuelos.guardar-instancia', 'inventory', 'upsertFlightInstance'], ['reservas.listar-boletos', 'ticketing', 'listTickets'],
      ['postventa.check-in', 'operations', 'checkIn'], ['clientes.crear-suscripcion', 'webhooks', 'createSubscription'], ['sistema.expirar-holds', 'inventory', 'expireHolds']
    ];
    for (const [operation, service, method] of cases) {
      invoker.calls.length = 0; behavior = () => ({});
      const role = operation === 'vuelos.guardar-instancia' ? 'admin' : operation === 'sistema.expirar-holds' ? 'system' : 'customer';
      expect((await post(operation, { input: {} }, { 'x-internal-key': KEY, 'x-role': role })).status).toBe(200);
      expect(invoker.calls[0]).toMatchObject({ service, method });
    }
  });

  it('ESB-ROUTE-06: el mapa de asientos resuelve el segmento y luego pide el mapa; devuelve el del segundo paso', async () => {
    invoker.calls.length = 0;
    behavior = (call) => call.method === 'resolveSegment' ? { ok: 1 } : { segmentId: 's-1', cabins: [] };
    const response = await post('vuelos.mapa-asientos', { input: { offerId: 'o-1', segmentId: 's-1', extra: 'ignorado' } });
    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({ segmentId: 's-1', cabins: [] });
    expect(invoker.calls.map((c) => [c.service, c.method, c.input])).toEqual([['pricing', 'resolveSegment', { segmentId: 's-1' }], ['ancillaries', 'getSeatMapForOffer', { offerId: 'o-1', segmentId: 's-1' }]]);
    expect(invoker.calls[0].deadlineAt).toEqual(invoker.calls[1].deadlineAt);
  });

  it('ESB-ROUTE-07: si el primer paso del mapa falla informa step=resolveSegment y no pide el mapa; si falla el segundo, step=getSeatMapForOffer', async () => {
    invoker.calls.length = 0; behavior = () => grpcError(5, 'NOT_FOUND');
    const first = await post('vuelos.mapa-asientos', { input: { offerId: 'o', segmentId: 's' } });
    expect(first.status).toBe(404); expect(first.body.error).toMatchObject({ grpcCode: 5, step: 'resolveSegment' }); expect(invoker.calls).toHaveLength(1);
    behavior = (call) => call.method === 'resolveSegment' ? {} : grpcError(5, 'NOT_FOUND');
    const second = await post('vuelos.mapa-asientos', { input: { offerId: 'o', segmentId: 's' } });
    expect(second.body.error).toMatchObject({ grpcCode: 5, step: 'getSeatMapForOffer' });
  });

  it('ESB-ROUTE-08: sistema.salud devuelve los siete servicios y HEALTHY/DEGRADED/DOWN según los críticos', async () => {
    const cases: Array<[string[], string]> = [[[], 'HEALTHY'], [['webhooks'], 'DEGRADED'], [['pricing'], 'DOWN']];
    for (const [down, status] of cases) {
      const local = await createEsbApp(testConfig(), { invoker: new FakeInvoker(), logger: new MemoryLogger(), probe: new FakeProbe(down) });
      const response = await request(local.getHttpServer()).post(`${URL}/sistema.salud`).set('x-internal-key', KEY).send({ input: { timeoutMs: 800 } });
      expect(response.body.result.status).toBe(status); expect(response.body.result.dependencias).toHaveLength(7);
      await local.close();
    }
    expect(probe.timeouts.length).toBeGreaterThan(0);
  });

  it('ESB-ROUTE-09: /health/deps responde 503 cuando cae un servicio crítico', async () => {
    const local = await createEsbApp(testConfig(), { invoker: new FakeInvoker(), logger: new MemoryLogger(), probe: new FakeProbe(['inventory']) });
    const response = await request(local.getHttpServer()).get('/health/deps').set('x-internal-key', KEY);
    expect(response.status).toBe(503); expect(response.body.status).toBe('DOWN');
    await local.close();
  });
});

describe('ESB-LOG: registro por operación', () => {
  it('ESB-LOG-01: registra operación, dominio, resultado, código y latencia, sin input ni identidad', async () => {
    logger.entries.length = 0; behavior = () => ({ secret: 'result-data' });
    await post('reservas.obtener', { input: { passenger: 'Ana Pérez', documentNumber: '1700000000' } }, { 'x-internal-key': KEY, 'x-correlation-id': 'c-1', 'x-owner-id': 'owner-secret' });
    behavior = () => grpcError(9, 'SEAT_TAKEN');
    await post('postventa.cambiar-asientos', { input: { email: 'ana@example.com' } }, { 'x-internal-key': KEY, 'x-correlation-id': 'c-2' });
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]).toMatchObject({ operation: 'reservas.obtener', domain: 'reservas', outcome: 'ok', grpcCode: 0, correlationId: 'c-1' });
    expect(logger.entries[1]).toMatchObject({ operation: 'postventa.cambiar-asientos', domain: 'postventa', outcome: 'error', grpcCode: 9, catalogCode: 'SEAT_TAKEN', source: 'service', correlationId: 'c-2' });
    for (const entry of logger.entries) {
      expect(typeof entry.latencyMs).toBe('number');
      const text = JSON.stringify(entry);
      for (const forbidden of ['Ana', '1700000000', 'owner-secret', 'ana@example.com', KEY, 'result-data']) expect(text).not.toContain(forbidden);
    }
  });
});
