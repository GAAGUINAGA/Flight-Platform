import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildEnvelope, BusUnavailableError, publishBackoffMs, type EventPayload } from '../domain/events';
import type { BusSession, EventBus, EventOperations, EventOutbox, ReleasedRow } from './event-ports';

/** Sobre mínimo del evento. La lista cerrada de eventos y el detalle de `data` los valida Webhooks (el ESB no duplica `WEBHOOK_EVENTS`). */
export const eventIntake = z.object({
  ownerId: z.string().min(1).max(128),
  payload: z.object({
    eventId: z.guid().optional(),
    eventType: z.string().regex(/^[a-z_]+\.[a-z_]+$/).max(64),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    apiVersion: z.string().min(1).max(32).optional(),
    correlationId: z.string().min(1).max(100).optional(),
    data: z.record(z.string(), z.unknown()).optional()
  }).strict()
}).strict();

export interface EventLimits { maxEventBytes: number; publishBatch: number; publishMaxBatches: number; leaseMs: number; retentionDays: number }
export const DEFAULT_EVENT_LIMITS: EventLimits = { maxEventBytes: 65_536, publishBatch: 100, publishMaxBatches: 5, leaseMs: 60_000, retentionDays: 7 };

const failure = (code: number, details: string): Error => Object.assign(new Error(details), { code, details });
/** Espacio libre del plazo que se deja para responder: no se reclaman lotes nuevos si queda menos. */
const DEADLINE_MARGIN_MS = 2_000;

export class OutboxEventOperations implements EventOperations {
  constructor(private readonly outbox: EventOutbox, private readonly bus: EventBus, private readonly limits: EventLimits = DEFAULT_EVENT_LIMITS, private readonly now: () => Date = () => new Date(), private readonly newId: () => string = randomUUID) {}

  /** Ingreso idempotente por `eventId`: el evento queda en la outbox y se responde sin tocar al broker. */
  async ingest(input: Record<string, unknown>): Promise<{ eventId: string }> {
    const parsed = eventIntake.safeParse(input);
    if (!parsed.success) throw failure(3, 'VALIDATION_FAILED');
    const { ownerId, payload: raw } = parsed.data;
    const now = this.now();
    const payload: EventPayload = {
      eventId: raw.eventId ?? this.newId(), eventType: raw.eventType, occurredAt: raw.occurredAt ?? now.toISOString(),
      ...(raw.apiVersion ? { apiVersion: raw.apiVersion } : {}), ...(raw.correlationId ? { correlationId: raw.correlationId } : {}), ...(raw.data ? { data: raw.data } : {})
    };
    const envelope = buildEnvelope(ownerId, payload);
    if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > this.limits.maxEventBytes) throw failure(3, 'VALIDATION_FAILED');
    await this.outbox.insert({ eventId: payload.eventId, routingKey: payload.eventType, ownerId, envelope }, now);
    return { eventId: payload.eventId };
  }

  /** Publica la outbox por lotes. Un broker caído no es un error de la operación: se informa `brokerAvailable: false` y las filas esperan. */
  async publishOutbox(deadlineAt: Date): Promise<{ claimed: number; published: number; pending: number; brokerAvailable: boolean }> {
    let claimed = 0; let published = 0; let brokerAvailable = true; let session: BusSession | undefined;
    try {
      for (let batch = 0; batch < this.limits.publishMaxBatches; batch += 1) {
        if (batch > 0 && this.now().getTime() > deadlineAt.getTime() - DEADLINE_MARGIN_MS) break;
        const rows = await this.outbox.claim(this.now(), this.limits.publishBatch, this.limits.leaseMs);
        if (rows.length === 0) break;
        claimed += rows.length;
        try { session ??= await this.bus.open(); } catch (thrown) {
          await this.release(rows.map((row) => ({ seq: row.seq, attempts: row.attempts, code: 'BROKER_UNAVAILABLE' })));
          if (thrown instanceof BusUnavailableError) { brokerAvailable = false; break; }
          throw thrown;
        }
        let report;
        try { report = await session.publish(rows); } catch {
          await this.release(rows.map((row) => ({ seq: row.seq, attempts: row.attempts, code: 'BROKER_UNAVAILABLE' })));
          brokerAvailable = false; break;
        }
        if (report.published.length) await this.outbox.markPublished(report.published, this.now());
        published += report.published.length;
        const byseq = new Map(rows.map((row) => [row.seq, row.attempts]));
        // Las filas que el broker no confirmó o no pudo enrutar se liberan con espera; esas no se reintentan en esta corrida.
        await this.release(report.failed.map((item) => ({ seq: item.seq, attempts: byseq.get(item.seq) ?? 1, code: item.code })));
        // Un mensaje sin cola es un problema de ese evento; cualquier otro fallo (conexión cortada, sin confirmación) es del broker.
        if (report.failed.some((item) => item.code !== 'UNROUTABLE')) brokerAvailable = false;
        if (report.failed.length || rows.length < this.limits.publishBatch) break;
      }
    } finally { await session?.close().catch(() => undefined); }
    await this.outbox.purgePublished(new Date(this.now().getTime() - this.limits.retentionDays * 86_400_000), 1_000);
    return { claimed, published, pending: await this.outbox.pendingCount(), brokerAvailable };
  }

  private async release(items: Array<{ seq: number; attempts: number; code: string }>): Promise<void> {
    if (!items.length) return;
    const now = this.now().getTime();
    const rows: ReleasedRow[] = items.map((item) => ({ seq: item.seq, errorCode: item.code, availableAt: new Date(now + publishBackoffMs(item.attempts)) }));
    await this.outbox.release(rows);
  }
}
