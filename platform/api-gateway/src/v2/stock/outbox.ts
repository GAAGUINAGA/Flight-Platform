import type { PrismaClient } from '../../../generated/prisma-client';

export interface StockOutboxRow { id: string; flightInstanceId: string; attempts: number; correlationId?: string }

/** Cola de envíos de stock pendientes: un vuelo con cambios, o un vuelo cuyo hold vence, se reenvía hasta que Booking confirme. */
export interface StockOutboxStore {
  enqueue(flightInstanceId: string, dueAt: Date, correlationId?: string): Promise<void>;
  claimDue(now: Date, limit: number): Promise<StockOutboxRow[]>;
  complete(ids: string[]): Promise<void>;
  /** `terminal` deja la fila en FAILED; si no, queda PENDING para `nextAt`. */
  fail(ids: string[], attempts: number, nextAt: Date, terminal: boolean): Promise<void>;
  pending(): Promise<number>;
}

interface MemoryRow extends StockOutboxRow { dueAt: Date; status: 'PENDING' | 'DONE' | 'FAILED' }
export class InMemoryStockOutbox implements StockOutboxStore {
  readonly rows: MemoryRow[] = [];
  async enqueue(flightInstanceId: string, dueAt: Date, correlationId?: string): Promise<void> { this.rows.push({ id: `${this.rows.length + 1}-${flightInstanceId}`, flightInstanceId, attempts: 0, correlationId, dueAt, status: 'PENDING' }); }
  async claimDue(now: Date, limit: number): Promise<StockOutboxRow[]> { return this.rows.filter((row) => row.status === 'PENDING' && row.dueAt <= now).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()).slice(0, limit).map(({ id, flightInstanceId, attempts, correlationId }) => ({ id, flightInstanceId, attempts, correlationId })); }
  async complete(ids: string[]): Promise<void> { for (const row of this.rows) if (ids.includes(row.id)) row.status = 'DONE'; }
  async fail(ids: string[], attempts: number, nextAt: Date, terminal: boolean): Promise<void> { for (const row of this.rows) if (ids.includes(row.id)) { row.attempts = attempts; row.dueAt = nextAt; row.status = terminal ? 'FAILED' : 'PENDING'; } }
  async pending(): Promise<number> { return this.rows.filter((row) => row.status === 'PENDING').length; }
}

export class PrismaStockOutbox implements StockOutboxStore {
  constructor(private readonly prisma: PrismaClient) {}
  async enqueue(flightInstanceId: string, dueAt: Date, correlationId?: string): Promise<void> { await this.prisma.stockOutbox.create({ data: { flightInstanceId, dueAt, correlationId: correlationId?.slice(0, 100) } }); }
  async claimDue(now: Date, limit: number): Promise<StockOutboxRow[]> {
    const rows = await this.prisma.stockOutbox.findMany({ where: { status: 'PENDING', dueAt: { lte: now } }, orderBy: { dueAt: 'asc' }, take: limit });
    return rows.map((row) => ({ id: row.id, flightInstanceId: row.flightInstanceId, attempts: row.attempts, ...(row.correlationId ? { correlationId: row.correlationId } : {}) }));
  }
  async complete(ids: string[]): Promise<void> { if (ids.length) await this.prisma.stockOutbox.updateMany({ where: { id: { in: ids } }, data: { status: 'DONE' } }); }
  async fail(ids: string[], attempts: number, nextAt: Date, terminal: boolean): Promise<void> { if (ids.length) await this.prisma.stockOutbox.updateMany({ where: { id: { in: ids } }, data: { attempts, dueAt: nextAt, status: terminal ? 'FAILED' : 'PENDING' } }); }
  async pending(): Promise<number> { return this.prisma.stockOutbox.count({ where: { status: 'PENDING' } }); }
}
