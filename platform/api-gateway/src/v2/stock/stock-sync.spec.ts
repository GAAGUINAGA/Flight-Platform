import { describe, expect, it, jest } from '@jest/globals';
import { loadConfig } from '../../config';
import { InMemoryStockOutbox } from './outbox';
import { localSlot, StockSync, type StockPusher, type StockUpdate } from './stock-sync';

const base = { NODE_ENV: 'test', INTERNAL_API_KEY: 'k'.repeat(24), PUBLIC_BASE_URL: 'http://gateway.test', JWT_ISSUERS: JSON.stringify([{ iss: 'u', aud: 'a', jwksUri: 'http://127.0.0.1:9/j' }]) };
class Recorder implements StockPusher { readonly sent: StockUpdate[] = []; fail = false; async push(update: StockUpdate): Promise<void> { if (this.fail) throw new Error('down'); this.sent.push(update); } }

describe('F12a P5 · configuración y utilidades del stock a Booking', () => {
  it('V2-STK-01 sin BOOKING_STOCK_API_KEY el envío queda apagado y nada se encola', async () => {
    const config = loadConfig(base); expect(config.v2!.stock.enabled).toBe(false);
    const store = new InMemoryStockOutbox(); const sync = new StockSync(config, store, new Recorder()); await sync.trigger(['11111111-1111-4111-8111-111111111111'], 'c'); expect(store.rows).toHaveLength(0);
  });
  it('V2-STK-02 con clave se activa, y STOCK_SYNC_ENABLED=false lo apaga aunque haya clave', () => {
    expect(loadConfig({ ...base, BOOKING_STOCK_API_KEY: 'abc', BOOKING_STOCK_GRPC_URL: 'stock.test:50051' }).v2!.stock.enabled).toBe(true); expect(loadConfig({ ...base, BOOKING_STOCK_API_KEY: 'abc', BOOKING_STOCK_GRPC_URL: 'stock.test:50051', STOCK_SYNC_ENABLED: 'false' }).v2!.stock.enabled).toBe(false);
  });
  it('V2-STK-03 TLS está activo por defecto y BOOKING_STOCK_TLS=false exige INTEGRATION_LOCAL=true', () => {
    expect(loadConfig({ ...base, BOOKING_STOCK_API_KEY: 'abc', BOOKING_STOCK_GRPC_URL: 'stock.test:50051' }).v2!.stock.tls).toBe(true);
    expect(() => loadConfig({ ...base, BOOKING_STOCK_TLS: 'false' })).toThrow('INTEGRATION_LOCAL');
    expect(loadConfig({ ...base, INTEGRATION_LOCAL: 'true', BOOKING_STOCK_TLS: 'false' }).v2!.stock.tls).toBe(false);
  });
  it('V2-STK-04 AIRPORT_TIMEZONES inválido falla al arrancar y uno válido se suma a los de Ecuador', () => {
    expect(() => loadConfig({ ...base, AIRPORT_TIMEZONES: '{no' })).toThrow('AIRPORT_TIMEZONES');
    expect(loadConfig({ ...base, AIRPORT_TIMEZONES: '{"BOG":"America/Bogota"}' }).v2!.stock.timezones).toMatchObject({ BOG: 'America/Bogota', UIO: 'America/Guayaquil' });
  });
  it('V2-STK-05 localSlot da fecha y hora locales del aeropuerto, incluso cuando cambia el día; sin zona usa UTC', () => {
    expect(localSlot('2026-11-02T03:30:00.000Z', 'UIO', { UIO: 'America/Guayaquil' })).toEqual({ date: '2026-11-01', time: '22:30' });
    expect(localSlot('2026-11-02T03:30:00.000Z', 'XXX', {})).toEqual({ date: '2026-11-02', time: '03:30' });
    expect(localSlot('2026-11-02T03:30:00.000Z', 'UIO', { UIO: 'No/Existe' })).toEqual({ date: '2026-11-02', time: '03:30' });
  });
  it('V2-STK-06 flightsOf lee los vuelos de un hold o de una reserva y no falla con datos vacíos', () => {
    const sync = new StockSync(loadConfig(base), new InMemoryStockOutbox(), new Recorder());
    expect(sync.flightsOf({ itineraries: [{ segments: [{ flightInstanceId: 'a' }, { flightInstanceId: 'b' }, {}] }, { segments: [{ flightInstanceId: 'c' }] }] })).toEqual(['a', 'b', 'c']); expect(sync.flightsOf(undefined)).toEqual([]); expect(sync.flightsOf({})).toEqual([]);
  });
  it('V2-STK-07 los fallos se reintentan con backoff y tras 8 intentos la fila se abandona (FAILED)', async () => {
    const config = loadConfig({ ...base, BOOKING_STOCK_API_KEY: 'abc', BOOKING_STOCK_GRPC_URL: 'stock.test:50051' }); const store = new InMemoryStockOutbox(); let now = new Date('2026-10-27T10:00:00.000Z'); const pusher = new Recorder(); pusher.fail = true;
    const sync = new StockSync(config, store, pusher, () => now); jest.spyOn(sync, 'snapshot').mockResolvedValue([{ service_id: 'n', item_id: 'X1-ECONOMY', date: '2026-11-01', time_slot: '10:00', available_units: 3, timestamp: 1 }]);
    await store.enqueue('flight', now, 'c'); const delays: number[] = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) { await sync.flush(); const row = store.rows[0]; delays.push(Math.round((row.dueAt.getTime() - now.getTime()) / 60_000)); now = new Date(row.dueAt.getTime() + 1000); }
    expect(delays.slice(0, 7)).toEqual([1, 2, 5, 15, 30, 60, 120]); expect(store.rows[0]).toMatchObject({ status: 'FAILED', attempts: 8 }); expect(await store.pending()).toBe(0);
  });
  it('V2-STK-08 varios cambios del mismo vuelo se juntan en un solo envío con la disponibilidad actual', async () => {
    const config = loadConfig({ ...base, BOOKING_STOCK_API_KEY: 'abc', BOOKING_STOCK_GRPC_URL: 'stock.test:50051' }); const store = new InMemoryStockOutbox(); const pusher = new Recorder(); const sync = new StockSync(config, store, pusher);
    const snapshot = jest.spyOn(sync, 'snapshot').mockResolvedValue([{ service_id: 'n', item_id: 'X1-ECONOMY', date: '2026-11-01', time_slot: '10:00', available_units: 2, timestamp: 1 }]);
    for (const at of [0, 1, 2]) await store.enqueue('flight', new Date(Date.now() - 1000 - at), 'c'); await sync.flush();
    expect(snapshot).toHaveBeenCalledTimes(1); expect(pusher.sent).toHaveLength(1); expect(store.rows.every((row) => row.status === 'DONE')).toBe(true);
  });
  it('V2-STK-09 un cambio futuro (vencimiento de hold) no se envía antes de su hora', async () => {
    const config = loadConfig({ ...base, BOOKING_STOCK_API_KEY: 'abc', BOOKING_STOCK_GRPC_URL: 'stock.test:50051' }); const store = new InMemoryStockOutbox(); const pusher = new Recorder(); const now = new Date('2026-10-27T10:00:00.000Z'); const sync = new StockSync(config, store, pusher, () => now);
    jest.spyOn(sync, 'snapshot').mockResolvedValue([{ service_id: 'n', item_id: 'X1-ECONOMY', date: '2026-11-01', time_slot: '10:00', available_units: 2, timestamp: 1 }]);
    await sync.trigger(['flight'], 'c', new Date(now.getTime() + 15 * 60_000)); await sync.flush(); expect(pusher.sent).toHaveLength(0); expect(await store.pending()).toBe(1);
  });
});
