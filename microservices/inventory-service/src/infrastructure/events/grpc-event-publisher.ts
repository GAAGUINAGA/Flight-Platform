import { randomUUID } from 'node:crypto';
import { firstValueFrom, type Observable } from 'rxjs';
import type { Logger } from 'pino';
import type { EventPublisher, PublicEvent } from '../../application/ports';
export interface WebhooksGrpcService { publishEvent(input: object): Observable<unknown>; }
export class GrpcEventPublisher implements EventPublisher { constructor(private readonly client: WebhooksGrpcService) {} async publish(event: PublicEvent): Promise<void> { await firstValueFrom(this.client.publishEvent({ ownerId: event.ownerId, payload: { eventId: randomUUID(), eventType: event.eventType, occurredAt: event.occurredAt.toISOString(), apiVersion: '1.5.0.0', data: { holdId: event.holdId, ...event.data } } })); } }
export class SafeEventPublisher implements EventPublisher { constructor(private readonly inner: EventPublisher, private readonly logger: Logger) {} async publish(event: PublicEvent): Promise<void> { try { await this.inner.publish(event); } catch (error) { const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN'; this.logger.warn({ dependency: 'webhooks', eventType: event.eventType, code }, 'event publish failed'); } } }
