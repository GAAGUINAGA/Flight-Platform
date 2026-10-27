import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { loadPackageDefinition, Server, ServerCredentials, status, type ServerUnaryCall, type sendUnaryData } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { InMemoryStockOutbox } from '../../../src/v2/stock/outbox';
import { localSlot, type StockSync, type StockUpdate } from '../../../src/v2/stock/stock-sync';
import { startStack, type Scenario, type Stack } from './stack';
import { book, headers, hold } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const API_KEY = `stock-key-${randomUUID()}`;

/** Simulador de la ingesta de stock de Booking (`inventory.InventoryStockService/PushStockUpdate`). */
class BookingStockSimulator {
  readonly calls: Array<{ update: StockUpdate; apiKey?: string; correlationId?: string }> = []; failing = false; port = 0; private server = new Server();
  async start(): Promise<void> {
    const definition = loadSync(join(process.cwd(), 'contracts', 'proto', 'external', 'booking', 'inventory.proto'), { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true });
    const service = (loadPackageDefinition(definition) as unknown as { inventory: { InventoryStockService: { service: never } } }).inventory.InventoryStockService.service;
    this.server.addService(service, {
      PushStockUpdate: (call: ServerUnaryCall<StockUpdate, unknown>, callback: sendUnaryData<unknown>) => {
        if (this.failing) return callback({ code: status.UNAVAILABLE, details: 'down' }, null);
        this.calls.push({ update: call.request, apiKey: call.metadata.get('x-api-key')[0] as string | undefined, correlationId: call.metadata.get('x-correlation-id')[0] as string | undefined });
        callback(null, { success: true, message: 'ok', processed_at: Date.now() });
      }
    } as never);
    this.port = await new Promise<number>((resolve, reject) => this.server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
  }
  forFlight(flightNumber: string): StockUpdate[] { return this.calls.filter((call) => call.update.item_id === `${flightNumber}-ECONOMY`).map((call) => call.update); }
  async stop(): Promise<void> { await new Promise<void>((resolve) => this.server.tryShutdown(() => resolve())); }
}

const until = async <T>(read: () => T, done: (value: T) => boolean, ms = 20_000): Promise<T> => { const end = Date.now() + ms; for (;;) { const value = read(); if (done(value) || Date.now() > end) return value; await new Promise((resolve) => globalThis.setTimeout(resolve, 100)); } };

describeReal('F12a P5 · stock hacia Booking por gRPC (contra servicios reales)', () => {
  const simulator = new BookingStockSimulator(); let stack: Stack; let outbox: InMemoryStockOutbox; const scenarios: Scenario[] = [];
  const scenario = async (options: Parameters<Stack['scenario']>[0] = {}) => { const value = await stack.scenario(options); scenarios.push(value); return value; };
  beforeAll(async () => {
    await simulator.start();
    stack = await startStack({ INTEGRATION_LOCAL: 'true', BOOKING_STOCK_API_KEY: API_KEY, BOOKING_STOCK_GRPC_URL: `127.0.0.1:${simulator.port}`, BOOKING_STOCK_TLS: 'false' });
    outbox = stack.gateway.get<StockSync>('STOCK_SYNC').store as InMemoryStockOutbox;
  }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); await simulator.stop(); }, 120_000);

  it('V2-P5-01 un hold baja la disponibilidad enviada: item, fecha local, hora y x-api-key/x-correlation-id', async () => {
    const s = await scenario({ sellable: 5 }); await hold(stack, s, s.client, 'u1');
    const updates = await until(() => simulator.forFlight(s.flightNumber), (list) => list.length >= 1); const last = updates[updates.length - 1];
    const slot = localSlot(s.departure.toISOString(), s.origin, {}); expect(last).toMatchObject({ service_id: 'NODE_VUE_GABATAIR', item_id: `${s.flightNumber}-ECONOMY`, date: slot.date, time_slot: slot.time, available_units: 4 }); expect(last.timestamp).toBeGreaterThan(0);
    const call = simulator.calls.find((c) => c.update.item_id === `${s.flightNumber}-ECONOMY`); expect(call?.apiKey).toBe(API_KEY); expect(call?.correlationId).toBeTruthy();
  }, 120_000);
  it('V2-P5-02 liberar el hold devuelve el asiento a la disponibilidad enviada', async () => {
    const s = await scenario({ sellable: 5 }); const held = await hold(stack, s, s.client, 'u1'); await until(() => simulator.forFlight(s.flightNumber), (list) => list.length >= 1);
    const res = await request(stack.server).delete(`/api/v2/vuelos/offers/hold/${held.holdId}`).set(await headers(stack, s.client, 'u1')).set('Idempotency-Key', randomUUID()); expect(res.status).toBe(204);
    const updates = await until(() => simulator.forFlight(s.flightNumber), (list) => list[list.length - 1]?.available_units === 5); expect(updates[updates.length - 1].available_units).toBe(5);
  }, 120_000);
  it('V2-P5-03 una reserva confirmada mantiene el asiento descontado y cancelarla lo devuelve', async () => {
    const s = await scenario({ sellable: 5 }); const held = await hold(stack, s, s.client, 'u1'); const created = await book(stack, s, s.client, 'u1', held); const id = created.response.body.bookingId as string; expect(created.response.status).toBe(201);
    const after = await until(() => simulator.forFlight(s.flightNumber), (list) => list.length >= 2); expect(after[after.length - 1].available_units).toBe(4);
    const cancel = await request(stack.server).post(`/api/v2/vuelos/bookings/${id}/cancel`).set(await headers(stack, s.client, 'u1')).set('Idempotency-Key', randomUUID()).send({ reasonCode: 'FLIGHT_CANCELLED' }); expect(cancel.status).toBe(200);
    const restored = await until(() => simulator.forFlight(s.flightNumber), (list) => list[list.length - 1]?.available_units === 5); expect(restored[restored.length - 1].available_units).toBe(5);
  }, 150_000);
  it('V2-P5-04 con Booking caído la operación responde igual, el envío queda en la cola y se reenvía al volver', async () => {
    const s = await scenario({ sellable: 5 }); simulator.failing = true; const before = simulator.calls.length;
    const held = await hold(stack, s, s.client, 'u1'); expect(held.holdId).toBeTruthy(); await new Promise((resolve) => globalThis.setTimeout(resolve, 1500)); expect(simulator.calls.length).toBe(before);
    const pending = await until(() => outbox.rows.filter((row) => row.flightInstanceId === s.flightId && row.status === 'PENDING' && row.attempts > 0), (rows) => rows.length > 0); expect(pending.length).toBeGreaterThan(0);
    simulator.failing = false; for (const row of pending) row.dueAt = new Date(Date.now() - 1000); await stack.scheduler.run('stock-sync');
    const sent = await until(() => simulator.forFlight(s.flightNumber), (list) => list.length >= 1); expect(sent[sent.length - 1].available_units).toBe(4);
    // Solo queda la fila futura del vencimiento del hold; nada vencido sin enviar.
    expect(outbox.rows.filter((row) => row.flightInstanceId === s.flightId && row.status === 'PENDING' && row.dueAt <= new Date())).toHaveLength(0);
  }, 150_000);
  it('V2-P5-05 un vuelo cerrado se informa con 0 unidades', async () => {
    const s = await scenario({ sellable: 5 }); await hold(stack, s, s.client, 'u1'); await until(() => simulator.forFlight(s.flightNumber), (list) => list.length >= 1);
    await stack.db.inventory.flightInstance.update({ where: { id: s.flightId }, data: { closed: true } }); await outbox.enqueue(s.flightId, new Date(Date.now() - 1000), 'test-closed'); await stack.scheduler.run('stock-sync');
    const updates = await until(() => simulator.forFlight(s.flightNumber), (list) => list[list.length - 1]?.available_units === 0); expect(updates[updates.length - 1].available_units).toBe(0);
  }, 150_000);
  it('V2-P5-06 el mensaje enviado trae solo los campos del contrato de Booking', async () => {
    const s = await scenario({ sellable: 5 }); await hold(stack, s, s.client, 'u1');
    const updates = await until(() => simulator.forFlight(s.flightNumber), (list) => list.length >= 1); expect(Object.keys(updates[0]).sort()).toEqual(['available_units', 'date', 'item_id', 'service_id', 'time_slot', 'timestamp']);
  }, 120_000);
});
