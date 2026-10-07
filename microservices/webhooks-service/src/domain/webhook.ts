import { DomainError } from '@flight-platform/shared';

export const WEBHOOK_EVENTS = ['booking.confirmed', 'booking.failed', 'booking.changed', 'booking.cancelled', 'booking.baggage_added', 'hold.expired', 'flight.schedule_changed', 'flight.cancelled', 'booking.ticket_issuing', 'booking.ticket_issued', 'booking.ticket_failed', 'booking.checked_in'] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];
export type WebhookPayload = { eventId: string; eventType: WebhookEvent; occurredAt: string; apiVersion: string; data?: { bookingId?: string; pnr?: string; status?: string; refundAmount?: string } };
export type Subscription = { id: string; ownerId: string; url: string; events: WebhookEvent[]; encryptedSecret: string; active: boolean };
export type Delivery = { id: string; eventId: string; subscriptionId: string; payload: WebhookPayload; status: 'PENDING' | 'DELIVERED' | 'FAILED'; attempts: number; nextAttemptAt: Date };

export function maskSecret(secret: string): string { return `****${secret.slice(-4)}`; }
export function retryAt(now: Date, attemptsAfterFailure: number, minutes: number[]): Date {
  const minute = minutes[Math.min(attemptsAfterFailure - 1, minutes.length - 1)];
  if (!minute) throw new DomainError('VALIDATION_FAILED');
  return new Date(now.getTime() + minute * 60_000);
}
