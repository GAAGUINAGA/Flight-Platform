import { createHmac, randomUUID } from 'node:crypto';
import { DomainError, RequestContext, requireRole } from '@flight-platform/shared';
import { z } from 'zod';
import { SecretCipher, HttpPoster, UrlPolicy, WebhookStore } from './ports';
import { createSubscription, deleteSubscription, dispatchPending, listSubscriptions, publishEvent } from './schemas';
import { Delivery, maskSecret, retryAt, WebhookPayload } from '../domain/webhook';

function validated<T extends z.ZodObject>(schema: T, input: unknown): z.output<T> {
  const result = schema.strict().safeParse(input);
  if (!result.success) throw new DomainError('VALIDATION_FAILED');
  return result.data as z.output<T>;
}

export class WebhookUseCases {
  constructor(private readonly store: WebhookStore, private readonly policy: UrlPolicy, private readonly cipher: SecretCipher, private readonly poster: HttpPoster, private readonly config: { timeoutMs: number; backoffMinutes: number[]; production: boolean }, private readonly now = () => new Date()) {}
  async create(_ctx: RequestContext, input: unknown) { const r = validated(createSubscription, input); await this.policy.assertSafe(r.url); const secret = r.secret ?? randomUUID().replaceAll('-', ''); const row = await this.store.createSubscription({ id: randomUUID(), ownerId: r.ownerId, url: r.url, events: r.events, encryptedSecret: this.cipher.encrypt(secret), active: true }); return { id: row.id, url: row.url, events: row.events, secret: maskSecret(secret) }; }
  async list(_ctx: RequestContext, input: unknown) { const r = validated(listSubscriptions, input); return (await this.store.listSubscriptions(r.ownerId)).map((s) => ({ id: s.id, url: s.url, events: s.events, secret: maskSecret(this.cipher.decrypt(s.encryptedSecret)) })); }
  async delete(_ctx: RequestContext, input: unknown) { const r = validated(deleteSubscription, input); if (!(await this.store.deleteSubscription(r.id, r.ownerId))) throw new DomainError('NOT_FOUND'); }
  async publish(_ctx: RequestContext, input: unknown) { const r = validated(publishEvent, input); const payload: WebhookPayload = { eventId: r.payload.eventId ?? randomUUID(), eventType: r.payload.eventType, occurredAt: new Date(r.payload.occurredAt ?? this.now()).toISOString(), apiVersion: r.payload.apiVersion ?? '1.5.0.0', ...(r.payload.data ? { data: r.payload.data } : {}) }; const subscriptions = await this.store.activeFor(r.ownerId, payload.eventType); await this.store.createDeliveries(payload.eventId, payload, subscriptions.map((s) => s.id), this.now()); return { eventId: payload.eventId }; }
  async dispatch(ctx: RequestContext, input: unknown) { requireRole(ctx, 'system'); validated(dispatchPending, input); const now = this.now(); const deliveries = await this.store.claimPending(now, 100, this.config.timeoutMs * 2); for (const delivery of deliveries) await this.send(delivery, now); return deliveries.length; }
  private async send(delivery: Delivery, now: Date): Promise<void> { const subscription = await this.store.getSubscription(delivery.subscriptionId); if (!subscription || !subscription.active) return; try { await this.policy.assertSafe(subscription.url); const body = JSON.stringify(delivery.payload); const timestamp = Math.floor(now.getTime() / 1000); const signature = createHmac('sha256', this.cipher.decrypt(subscription.encryptedSecret)).update(`${timestamp}.${body}`).digest('hex'); const result = await this.poster.post(subscription.url, body, { 'content-type': 'application/json', 'x-flight-signature': `t=${timestamp},v1=${signature}` }, this.config.timeoutMs); if (result >= 200 && result < 300) return this.store.delivered(delivery.id, now); throw new Error('delivery rejected'); } catch { const attempts = delivery.attempts + 1; const terminal = attempts > this.config.backoffMinutes.length; await this.store.failed(delivery.id, attempts, terminal ? now : retryAt(now, attempts, this.config.backoffMinutes), terminal, now); } }
}
