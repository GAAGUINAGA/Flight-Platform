import { Prisma } from '../generated/prisma-client';
import { PrismaClient } from '../generated/prisma-client';

export interface SchedulerStore { acquire(task: string, now: Date, lockedUntil: Date): Promise<boolean>; release(task: string): Promise<void>; purgeIdempotency(now: Date): Promise<number>; }
export class PrismaSchedulerStore implements SchedulerStore {
  constructor(private readonly prisma: PrismaClient) {}
  async acquire(task: string, now: Date, lockedUntil: Date): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ task: string }>>(Prisma.sql`INSERT INTO gateway.scheduler_locks (task, locked_until) VALUES (${task}, ${lockedUntil}) ON CONFLICT (task) DO UPDATE SET locked_until = EXCLUDED.locked_until WHERE gateway.scheduler_locks.locked_until <= ${now} RETURNING task`);
    return rows.length === 1;
  }
  async release(task: string): Promise<void> { await this.prisma.schedulerLock.updateMany({ where: { task }, data: { lockedUntil: new Date(0) } }); }
  async purgeIdempotency(now: Date): Promise<number> { return (await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } })).count; }
}
