import { DomainError } from '@flight-platform/shared';

export const WEBHOOK_EVENTS = ['booking.confirmed', 'booking.failed', 'booking.changed', 'booking.cancelled', 'booking.baggage_added', 'hold.expired', 'flight.schedule_changed', 'flight.cancelled', 'booking.ticket_issuing', 'booking.ticket_issued', 'booking.ticket_failed', 'booking.checked_in', 'hold.created', 'booking.seat_changed', 'flight.status_changed'] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];
/** `extra`, `correlationId`, `seq` y `ownerId` son solo de v2 (CloudEvents); la entrega v1 los omite para no cambiar su cuerpo. */
export type WebhookPayload = { eventId: string; eventType: WebhookEvent; occurredAt: string; apiVersion: string; data?: { bookingId?: string; pnr?: string; status?: string; refundAmount?: string; holdId?: string; [key: string]: unknown }; correlationId?: string; seq?: number; ownerId?: string; extra?: Record<string, unknown> };
export type Subscription = { id: string; ownerId: string; url: string; events: WebhookEvent[]; encryptedSecret: string; active: boolean; apiVersion?: string; createdAt?: Date };
export type Delivery = { id: string; eventId: string; subscriptionId: string; payload: WebhookPayload; status: 'PENDING' | 'DELIVERED' | 'FAILED'; attempts: number; nextAttemptAt: Date };
export type StoredEvent = { seq: number; eventId: string; ownerId: string; eventType: string; occurredAt: string; apiVersion: string; correlationId?: string; data: Record<string, unknown> };

export function maskSecret(secret: string): string { return `****${secret.slice(-4)}`; }
export function retryAt(now: Date, attemptsAfterFailure: number, minutes: number[]): Date {
  const minute = minutes[Math.min(attemptsAfterFailure - 1, minutes.length - 1)];
  if (!minute) throw new DomainError('VALIDATION_FAILED');
  return new Date(now.getTime() + minute * 60_000);
}

/** Cuerpo de la entrega v1: exactamente las cinco propiedades de siempre, en el mismo orden. */
export const v1Body = (payload: WebhookPayload): Record<string, unknown> => ({ eventId: payload.eventId, eventType: payload.eventType, occurredAt: payload.occurredAt, apiVersion: payload.apiVersion, ...(payload.data ? { data: payload.data } : {}) });

export const COMPOSITE_SEPARATOR = '~';
/** Dueños a los que puede pertenecer una suscripción que recibe los eventos de `ownerId` (D1): el propio dueño y su cliente (`<clientId>`). */
export const subscriberOwners = (ownerId: string): string[] => { const client = ownerId.split(COMPOSITE_SEPARATOR, 1)[0]; return client === ownerId ? [ownerId] : [ownerId, client]; };

export const CLOUD_EVENT_TYPE_PREFIX = 'ec.edu.epn.booking.vuelos.';
export const cloudEventId = (seq: number): string => `evt-vue-${String(seq).padStart(6, '0')}`;
const subjectOf = (data: Record<string, unknown>): string | undefined => typeof data.bookingId === 'string' ? data.bookingId : typeof data.holdId === 'string' ? data.holdId : typeof data.flightNumber === 'string' ? `${data.flightNumber}${typeof data.date === 'string' ? `/${data.date}` : ''}` : undefined;
/** Parte del dueño visible para el consumidor: el `X-User-Id` de un dueño compuesto; un dueño sin prefijo de cliente no se expone. */
const publicOwner = (ownerId?: string): string | undefined => ownerId && ownerId.includes(COMPOSITE_SEPARATOR) ? ownerId.slice(ownerId.indexOf(COMPOSITE_SEPARATOR) + 1) : undefined;

export function buildCloudEvent(payload: WebhookPayload, sourceCode: string): Record<string, unknown> {
  const owner = publicOwner(payload.ownerId);
  // Los campos base del evento prevalecen sobre los extra: un publicador no puede reescribir bookingId, pnr ni status.
  const data: Record<string, unknown> = { ...(payload.extra ?? {}), ...(payload.data ?? {}), ...(owner ? { ownerId: owner } : {}) };
  const subject = subjectOf(data);
  return {
    specversion: '1.0', type: `${CLOUD_EVENT_TYPE_PREFIX}${payload.eventType}`, source: `/aerolineas/${sourceCode}/vuelos`, id: payload.seq !== undefined ? cloudEventId(payload.seq) : payload.eventId,
    time: payload.occurredAt, ...(subject ? { subject } : {}), datacontenttype: 'application/json', correlationid: payload.correlationId ?? payload.eventId, data
  };
}
