import { Delivery, Subscription, WebhookPayload } from '../domain/webhook';

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
export interface UrlPolicy { assertSafe(url: string): Promise<void>; }
export interface SecretCipher { encrypt(value: string): string; decrypt(value: string): string; }
export interface HttpPoster { post(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<number>; }
