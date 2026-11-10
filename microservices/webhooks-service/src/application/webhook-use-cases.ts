import { createHmac, randomUUID } from 'node:crypto';
import { DomainError, RequestContext, requireRole } from '@flight-platform/shared';
import { z } from 'zod';
import { BusMessage, EventBusConsumer, EventLog, SecretCipher, HttpPoster, UrlPolicy, WebhookStore } from './ports';
import { retryDecision } from '../domain/event-retry';
import { createSubscription, deleteSubscription, dispatchPending, listEvents, listSubscriptions, publishEvent } from './schemas';
import { buildCloudEvent, Delivery, maskSecret, retryAt, Subscription, v1Body, WebhookPayload } from '../domain/webhook';

function validated<T extends z.ZodObject>(schema: T, input: unknown): z.output<T> {
  const result = schema.strict().safeParse(input);
  if (!result.success) throw new DomainError('VALIDATION_FAILED');
  return result.data as z.output<T>;
}

/** Campos extra del evento v2: un objeto JSON plano; cualquier otra forma se rechaza. */
function parseExtra(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new DomainError('VALIDATION_FAILED'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DomainError('VALIDATION_FAILED');
  return parsed as Record<string, unknown>;
}

const subscriptionView = (s: Subscription, secret: string) => ({ id: s.id, url: s.url, events: s.events, secret: maskSecret(secret), ...(s.apiVersion === '2' ? { active: s.active, ...(s.createdAt ? { createdAt: s.createdAt.toISOString() } : {}) } : {}) });

export interface EventIngestConfig { queue: string; maxAttempts: number; pullBatch: number; pullMaxBatches: number; pullBudgetMs: number; log?: (entry: object, message: string) => void }

export class WebhookUseCases {
  constructor(private readonly store: WebhookStore, private readonly policy: UrlPolicy, private readonly cipher: SecretCipher, private readonly poster: HttpPoster, private readonly config: { timeoutMs: number; backoffMinutes: number[]; production: boolean; sourceCode?: string; /** Reintentos de las suscripciones v2 (el contrato fija 1, 5, 30, 120 y 360 min). */ backoffMinutesV2?: number[]; /** Consumo del bus de eventos (F12b-2); sin `bus` no se retira nada. */ events?: EventIngestConfig }, private readonly now = () => new Date(), private readonly eventLog?: EventLog, private readonly bus?: EventBusConsumer) {}
  async create(_ctx: RequestContext, input: unknown) { const r = validated(createSubscription, input); await this.policy.assertSafe(r.url); const secret = r.secret ?? randomUUID().replaceAll('-', ''); const row = await this.store.createSubscription({ id: randomUUID(), ownerId: r.ownerId, url: r.url, events: r.events, encryptedSecret: this.cipher.encrypt(secret), active: true, ...(r.apiVersion === '2' ? { apiVersion: '2' } : {}) }); return subscriptionView({ ...row, apiVersion: r.apiVersion }, secret); }
  async list(_ctx: RequestContext, input: unknown) { const r = validated(listSubscriptions, input); return (await this.store.listSubscriptions(r.ownerId)).map((s) => subscriptionView(s, this.cipher.decrypt(s.encryptedSecret))); }
  async delete(_ctx: RequestContext, input: unknown) { const r = validated(deleteSubscription, input); if (!(await this.store.deleteSubscription(r.id, r.ownerId))) throw new DomainError('NOT_FOUND'); }
  async publish(_ctx: RequestContext, input: unknown) {
    const r = validated(publishEvent, input);
    const { dataJson, ...core } = r.payload.data ?? {}; const extra = dataJson ? parseExtra(dataJson) : undefined;
    const payload: WebhookPayload = { eventId: r.payload.eventId ?? randomUUID(), eventType: r.payload.eventType, occurredAt: new Date(r.payload.occurredAt ?? this.now()).toISOString(), apiVersion: r.payload.apiVersion ?? '1.5.0.0', ...(r.payload.data ? { data: core } : {}) };
    if (this.eventLog) {
      payload.seq = await this.eventLog.recordEvent({ eventId: payload.eventId, ownerId: r.ownerId, eventType: payload.eventType, occurredAt: new Date(payload.occurredAt), apiVersion: payload.apiVersion, correlationId: r.payload.correlationId, data: { ...(extra ?? {}), ...core } });
      payload.ownerId = r.ownerId; if (r.payload.correlationId) payload.correlationId = r.payload.correlationId; if (extra) payload.extra = extra;
    }
    const subscriptions = await this.store.activeFor(r.ownerId, payload.eventType); await this.store.createDeliveries(payload.eventId, payload, subscriptions.map((s) => s.id), this.now()); return { eventId: payload.eventId };
  }
  async listEvents(_ctx: RequestContext, input: unknown) {
    const r = validated(listEvents, input); if (!this.eventLog) throw new DomainError('VALIDATION_FAILED');
    const { items, total } = await this.eventLog.listEvents({ ownerPrefix: r.ownerPrefix, afterSeq: r.afterSeq, limit: r.limit ?? 50, eventType: r.eventType });
    return { items: items.map((e) => ({ seq: e.seq, eventId: e.eventId, ownerId: e.ownerId, eventType: e.eventType, occurredAt: e.occurredAt, apiVersion: e.apiVersion, ...(e.correlationId ? { correlationId: e.correlationId } : {}), dataJson: JSON.stringify(e.data) })), total };
  }
  /**
   * Retira por lotes los eventos del bus (ADR-F12b-04/05) y los ingresa con el mismo caso de uso que `PublishEvent`: el feed y las entregas salen
   * idénticos. Es idempotente por `eventId` (`events.event_id` y `deliveries (event_id, subscription_id)` únicos). Nunca lanza: un broker caído
   * solo se registra y las entregas ya pendientes siguen su curso.
   */
  async ingest(ctx: RequestContext): Promise<{ ingested: number; retried: number; failed: number }> {
    const result = { ingested: 0, retried: 0, failed: 0 };
    const settings = this.config.events;
    if (!this.bus || !settings) return result;
    const log = settings.log ?? (() => undefined);
    let batch; try { batch = await this.bus.open(); } catch { log({ dependency: 'event-bus', code: 'BUS_UNAVAILABLE' }, 'event ingestion skipped'); return result; }
    const limit = settings.pullBatch * settings.pullMaxBatches; const started = Date.now();
    try {
      for (let taken = 0; taken < limit && Date.now() - started < settings.pullBudgetMs; taken += 1) {
        const message = await batch.next();
        if (!message) break;
        const outcome = await this.handleMessage(ctx, message, settings);
        result[outcome] += 1;
      }
    } catch { log({ dependency: 'event-bus', code: 'BUS_ERROR' }, 'event ingestion interrupted'); } finally { await batch.close().catch(() => undefined); }
    if (result.ingested || result.retried || result.failed) log({ ...result }, 'events ingested from bus');
    return result;
  }
  private async handleMessage(ctx: RequestContext, message: BusMessage, settings: EventIngestConfig): Promise<'ingested' | 'retried' | 'failed'> {
    let data: unknown;
    try {
      const envelope: unknown = JSON.parse(message.body);
      if (typeof envelope !== 'object' || envelope === null || (envelope as { specversion?: unknown }).specversion !== '1.0') throw new DomainError('VALIDATION_FAILED');
      data = (envelope as { data?: unknown }).data;
    } catch { return this.settle(message, settings, false, 'INVALID_ENVELOPE'); }
    try { await this.publish(ctx, data); await message.ack(); return 'ingested'; } catch (error) {
      const permanent = error instanceof DomainError && error.code === 'VALIDATION_FAILED';
      return this.settle(message, settings, !permanent, permanent ? 'VALIDATION_FAILED' : 'INGEST_FAILED');
    }
  }
  private async settle(message: BusMessage, settings: EventIngestConfig, retryable: boolean, reason: string): Promise<'retried' | 'failed'> {
    const decision = retryDecision(settings.queue, message.attempt, settings.maxAttempts, retryable);
    try { await message.moveTo(decision.queue, decision.action === 'retry' ? decision.attempt : message.attempt, reason); } catch { await message.requeue().catch(() => undefined); }
    return decision.action === 'retry' ? 'retried' : 'failed';
  }
  async dispatch(ctx: RequestContext, input: unknown) { requireRole(ctx, 'system'); validated(dispatchPending, input); await this.ingest(ctx); const now = this.now(); const deliveries = await this.store.claimPending(now, 100, this.config.timeoutMs * 2); for (const delivery of deliveries) await this.send(delivery, now); return deliveries.length; }
  private async send(delivery: Delivery, now: Date): Promise<void> {
    const subscription = await this.store.getSubscription(delivery.subscriptionId); if (!subscription || !subscription.active) return;
    try {
      await this.policy.assertSafe(subscription.url);
      const secret = this.cipher.decrypt(subscription.encryptedSecret); let body: string; let headers: Record<string, string>;
      if (subscription.apiVersion === '2') {
        // v2: CloudEvents v1.0 firmado con HMAC-SHA256 del cuerpo (sin marca de tiempo), como pide el contrato.
        body = JSON.stringify(buildCloudEvent(delivery.payload, this.config.sourceCode ?? 'gabatair'));
        headers = { 'content-type': 'application/cloudevents+json; charset=utf-8', 'x-webhook-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`, 'x-correlation-id': delivery.payload.correlationId ?? delivery.payload.eventId };
      } else {
        body = JSON.stringify(v1Body(delivery.payload)); const timestamp = Math.floor(now.getTime() / 1000);
        headers = { 'content-type': 'application/json', 'x-flight-signature': `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}` };
      }
      const result = await this.poster.post(subscription.url, body, headers, this.config.timeoutMs);
      if (result >= 200 && result < 300) return this.store.delivered(delivery.id, now);
      throw new Error('delivery rejected');
    } catch { const schedule = subscription.apiVersion === '2' ? (this.config.backoffMinutesV2 ?? this.config.backoffMinutes) : this.config.backoffMinutes; const attempts = delivery.attempts + 1; const terminal = attempts > schedule.length; await this.store.failed(delivery.id, attempts, terminal ? now : retryAt(now, attempts, schedule), terminal, now); }
  }
}
