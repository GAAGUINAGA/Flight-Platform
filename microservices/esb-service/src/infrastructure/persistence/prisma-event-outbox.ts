import type { EventOutbox, NewOutboxEvent, OutboxRow, ReleasedRow } from '../../application/event-ports';
import type { CloudEventEnvelope } from '../../domain/events';
import { Prisma, type PrismaClient } from './prisma-client/client';
import { table } from './schema';

interface ClaimedRow { seq: bigint; event_id: string; routing_key: string; envelope: CloudEventEnvelope; attempts: number }

/**
 * Outbox en `esb.outbox_events`. Cada operación es una sola sentencia (compatible con el pooler de Supabase en modo transacción);
 * el reclamo usa `FOR UPDATE SKIP LOCKED` más un arriendo, así dos instancias nunca reciben la misma fila.
 */
export class PrismaEventOutbox implements EventOutbox {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(event: NewOutboxEvent, now: Date): Promise<boolean> {
    const inserted = await this.prisma.$executeRaw`INSERT INTO ${table('outbox_events')} (event_id, routing_key, owner_id, envelope, status, attempts, available_at, created_at)
      VALUES (${event.eventId}::uuid, ${event.routingKey}, ${event.ownerId}, ${JSON.stringify(event.envelope)}::jsonb, 'PENDING', 0, ${now}, ${now})
      ON CONFLICT (event_id) DO NOTHING`;
    return inserted > 0;
  }

  async claim(now: Date, limit: number, leaseMs: number): Promise<OutboxRow[]> {
    const lockedUntil = new Date(now.getTime() + leaseMs);
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`UPDATE ${table('outbox_events')} SET locked_until = ${lockedUntil}, attempts = attempts + 1
      WHERE seq IN (
        SELECT seq FROM ${table('outbox_events')}
        WHERE status = 'PENDING' AND available_at <= ${now} AND (locked_until IS NULL OR locked_until < ${now})
        ORDER BY seq LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING seq, event_id, routing_key, envelope, attempts`;
    return rows.map((row) => ({ seq: Number(row.seq), eventId: row.event_id, routingKey: row.routing_key, envelope: row.envelope, attempts: row.attempts })).sort((a, b) => a.seq - b.seq);
  }

  async markPublished(seqs: number[], now: Date): Promise<void> {
    if (!seqs.length) return;
    await this.prisma.$executeRaw`UPDATE ${table('outbox_events')} SET status = 'PUBLISHED', published_at = ${now}, locked_until = NULL, last_error = NULL
      WHERE seq IN (${Prisma.join(seqs)})`;
  }

  async release(rows: ReleasedRow[]): Promise<void> {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((row) => this.prisma.$executeRaw`UPDATE ${table('outbox_events')} SET locked_until = NULL, available_at = ${row.availableAt}, last_error = ${row.errorCode}
      WHERE seq = ${row.seq} AND status = 'PENDING'`));
  }

  async purgePublished(before: Date, limit: number): Promise<number> {
    return this.prisma.$executeRaw`DELETE FROM ${table('outbox_events')}
      WHERE seq IN (SELECT seq FROM ${table('outbox_events')} WHERE status = 'PUBLISHED' AND published_at < ${before} LIMIT ${limit})`;
  }

  async pendingCount(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ total: number }>>`SELECT count(*)::int AS total FROM ${table('outbox_events')} WHERE status = 'PENDING'`;
    return row?.total ?? 0;
  }
}
