import { Delivery, StoredEvent, Subscription, WebhookPayload } from '../domain/webhook';

export interface WebhookStore {
  createSubscription(input: Subscription): Promise<Subscription>;
  listSubscriptions(ownerId: string): Promise<Subscription[]>;
  deleteSubscription(id: string, ownerId: string): Promise<boolean>;
  activeFor(ownerId: string, eventType: string): Promise<Subscription[]>;
  getSubscription(id: string): Promise<Subscription | null>;
  createDeliveries(eventId: string, payload: WebhookPayload, subscriptionIds: string[], now: Date): Promise<void>;
  claimPending(now: Date, limit: number, processingTimeoutMs: number): Promise<Delivery[]>;
  delivered(id: string, now: Date): Promise<void>;
  failed(id: string, attempts: number, nextAttemptAt: Date, terminal: boolean, now: Date): Promise<void>;
}
/** Almacén global de eventos (F12a): respalda `GET /vuelos/eventos` aunque no haya suscripciones. */
export interface EventLog {
  /** Idempotente por `eventId`: un reintento del publicador devuelve el mismo `seq`. */
  recordEvent(input: { eventId: string; ownerId: string; eventType: string; occurredAt: Date; apiVersion: string; correlationId?: string; data: Record<string, unknown> }): Promise<number>;
  listEvents(input: { ownerPrefix: string; afterSeq?: number; limit: number; eventType?: string }): Promise<{ items: StoredEvent[]; total: number }>;
}
export interface UrlPolicy { assertSafe(url: string): Promise<void>; }
export interface SecretCipher { encrypt(value: string): string; decrypt(value: string): string; }
export interface HttpPoster { post(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<number>; }
