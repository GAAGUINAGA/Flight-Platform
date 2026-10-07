import { EventPublisher, ExpiredHold } from './ports';

/** Publicaci?n de mejor esfuerzo: un fallo del publicador no revierte la expiraci?n (D-04, D-16). */
export async function publishExpired(
  events: EventPublisher,
  expired: ExpiredHold[],
  now: Date,
  correlationId?: string
): Promise<void> {
  for (const hold of expired) {
    try {
      await events.publish({
        eventType: 'hold.expired', ownerId: hold.ownerId, holdId: hold.holdId,
        occurredAt: now, correlationId, data: { status: 'EXPIRED' }
      });
    } catch {
      // sin detalles: el evento se reintenta en una capa superior cuando exista Webhooks
    }
  }
}
