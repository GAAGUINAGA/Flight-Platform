import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { GatewayConfig } from './config';
import * as grpc from './grpc-clients';
import type { SchedulerStore } from './scheduler-store';

type Task = 'expire-holds' | 'resume-pending' | 'dispatch-pending' | 'recover-check-ins' | 'purge-idempotency' | 'stock-sync';
export class GatewayScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly timers: Array<ReturnType<typeof globalThis.setInterval>> = [];
  private readonly logger = new Logger(GatewayScheduler.name);
  constructor(private readonly config: GatewayConfig, private readonly store: SchedulerStore, private readonly clock: () => Date = () => new Date(), private readonly stock?: { enabled: boolean; flush(): Promise<void> }) {}
  private get tasks(): Task[] { return this.stock?.enabled ? ['expire-holds', 'resume-pending', 'dispatch-pending', 'recover-check-ins', 'stock-sync'] : ['expire-holds', 'resume-pending', 'dispatch-pending', 'recover-check-ins']; }
  async onModuleInit(): Promise<void> { if (!this.config.schedulerEnabled) return; await this.runAll(); for (const task of this.tasks) this.timers.push(globalThis.setInterval(() => void this.run(task), this.config.schedulerEveryMs)); this.timers.push(globalThis.setInterval(() => void this.run('purge-idempotency'), this.config.schedulerPurgeEveryMs)); }
  onModuleDestroy(): void { for (const timer of this.timers) globalThis.clearInterval(timer); this.timers.length = 0; }
  async runAll(): Promise<void> { await Promise.all([...this.tasks, 'purge-idempotency' as Task].map((task) => this.run(task))); }
  async run(task: Task): Promise<void> {
    const now = this.clock(); if (!await this.store.acquire(task, now, new Date(now.getTime() + this.config.schedulerLockLeaseMs))) return;
    try {
      if (task === 'purge-idempotency') { await this.store.purgeIdempotency(now); return; }
      if (task === 'stock-sync') { await this.stock?.flush(); return; }
      const auth = { ownerId: 'gateway-scheduler', role: 'system', scopes: new Set<string>() };
      if (task === 'expire-holds') await grpc.callGatewayGrpc(this.config, 'inventory', 'expireHolds', {}, 'gateway-scheduler', auth);
      if (task === 'resume-pending') await grpc.callGatewayGrpc(this.config, 'reservation', 'resumePending', { limit: this.config.schedulerBatchSize }, 'gateway-scheduler', auth);
      if (task === 'dispatch-pending') await grpc.callGatewayGrpc(this.config, 'webhooks', 'dispatchPending', {}, 'gateway-scheduler', auth);
      if (task === 'recover-check-ins') await grpc.callGatewayGrpc(this.config, 'operations', 'recoverCheckIns', { limit: this.config.schedulerBatchSize }, 'gateway-scheduler', auth);
    } catch (error) { const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN'; this.logger.warn(JSON.stringify({ task, dependency: task === 'purge-idempotency' ? 'gateway-db' : 'grpc', code })); }
    finally { await this.store.release(task); }
  }
}
