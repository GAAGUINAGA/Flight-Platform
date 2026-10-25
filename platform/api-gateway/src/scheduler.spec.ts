import { afterEach, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import * as grpc from './grpc-clients';
import { GatewayScheduler } from './scheduler';
import type { GatewayConfig } from './config';
import type { SchedulerStore } from './scheduler-store';

const config: GatewayConfig = { port: 3000, internalApiKey: 'x'.repeat(32), jwtIssuers: [], corsOrigins: [], publicLimit: 1, authLimit: 1, idempotencyTtlHours: 24, validateResponses: false, schedulerEnabled: true, schedulerEveryMs: 60_000, schedulerPurgeEveryMs: 3_600_000, schedulerBatchSize: 7, schedulerLockLeaseMs: 55_000, grpcTls: false };
class Store implements SchedulerStore {
  acquired = new Set<string>(); released: string[] = []; purged = 0;
  async acquire(task: string) { if (this.acquired.has(task)) return false; this.acquired.add(task); return true; }
  async release(task: string) { this.released.push(task); this.acquired.delete(task); }
  async purgeIdempotency() { this.purged += 1; return this.purged; }
}

describe('PLT-H2 scheduler', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  it('PLT-H2-01: la ronda inicial dispara las cinco tareas con rol system y lotes acotados', async () => {
    const store = new Store(); const calls: Array<[string, string, object, { role: string } | undefined]> = [];
    jest.spyOn(grpc, 'callGatewayGrpc').mockImplementation(async (_config, service, method, input, _correlation, auth) => { calls.push([service, method, input, auth]); return {}; });
    const scheduler = new GatewayScheduler(config, store, () => new Date('2026-10-23T12:00:00.000Z'));
    await scheduler.runAll(); scheduler.onModuleDestroy();
    expect(calls).toEqual(expect.arrayContaining([['inventory', 'expireHolds', {}, expect.objectContaining({ role: 'system' })], ['reservation', 'resumePending', { limit: 7 }, expect.objectContaining({ role: 'system' })], ['webhooks', 'dispatchPending', {}, expect.objectContaining({ role: 'system' })], ['operations', 'recoverCheckIns', { limit: 7 }, expect.objectContaining({ role: 'system' })]]));
    expect(store.purged).toBe(1);
  });
  it('PLT-H2-02: dos ejecuciones simultáneas no procesan una tarea dos veces', async () => {
    const store = new Store(); const call = jest.spyOn(grpc, 'callGatewayGrpc').mockResolvedValue({});
    const scheduler = new GatewayScheduler(config, store);
    await Promise.all([scheduler.run('resume-pending'), scheduler.run('resume-pending')]);
    expect(call).toHaveBeenCalledTimes(1); expect(store.released).toEqual(['resume-pending']);
  });
  it('PLT-H2-03: el fallo de una dependencia no impide las demás tareas', async () => {
    const store = new Store(); const call = jest.spyOn(grpc, 'callGatewayGrpc').mockImplementation(async (_config, service) => { if (service === 'inventory') throw Object.assign(new Error('down'), { code: 14 }); return {}; });
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await new GatewayScheduler(config, store).runAll();
    expect(call).toHaveBeenCalledTimes(4); expect(warning).toHaveBeenCalled(); expect(store.purged).toBe(1);
  });
  it('PLT-H2-04: desactivado no programa ronda inicial ni temporizadores', async () => {
    jest.useFakeTimers();
    const store = new Store(); const call = jest.spyOn(grpc, 'callGatewayGrpc').mockResolvedValue({});
    const scheduler = new GatewayScheduler({ ...config, schedulerEnabled: false }, store);
    await scheduler.onModuleInit(); scheduler.onModuleDestroy();
    expect(call).not.toHaveBeenCalled(); expect(store.acquired).toEqual(new Set()); expect(jest.getTimerCount()).toBe(0);
  });
  it('PLT-H2-05: desactivado permite invocar una tarea manualmente con bloqueo durable', async () => {
    const store = new Store(); const call = jest.spyOn(grpc, 'callGatewayGrpc').mockResolvedValue({});
    const scheduler = new GatewayScheduler({ ...config, schedulerEnabled: false }, store, () => new Date('2026-10-23T13:05:00.000Z'));
    await scheduler.run('resume-pending');
    expect(call).toHaveBeenCalledWith(expect.anything(), 'reservation', 'resumePending', { limit: 7 }, 'gateway-scheduler', expect.objectContaining({ role: 'system' }));
    expect(store.released).toEqual(['resume-pending']);
  });
  it('PLT-H2-06: activado ejecuta la ronda inicial y cancela sus cinco temporizadores al destruirse', async () => {
    jest.useFakeTimers();
    const store = new Store(); const call = jest.spyOn(grpc, 'callGatewayGrpc').mockResolvedValue({});
    const scheduler = new GatewayScheduler(config, store);
    await scheduler.onModuleInit();
    expect(call).toHaveBeenCalledTimes(4); expect(store.purged).toBe(1); expect(jest.getTimerCount()).toBe(5);
    scheduler.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
