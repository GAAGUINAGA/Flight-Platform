import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';

const logger = new Logger('V2Events');

export interface V2Event { eventType: string; eventId?: string; correlationId?: string; data?: { bookingId?: string; pnr?: string; status?: string; holdId?: string; refundAmount?: string }; extra?: Record<string, unknown> }

/** Publica un evento de la fachada v2 en Webhooks (mejor esfuerzo: un fallo no deshace la operación; el feed y el reintento lo cubren). */
export async function publishV2Event(config: GatewayConfig, ownerId: string, event: V2Event): Promise<void> {
  const correlationId = event.correlationId ?? '';
  try {
    await callGatewayGrpc(config, 'webhooks', 'publishEvent', {
      ownerId, payload: { eventId: event.eventId ?? randomUUID(), eventType: event.eventType, occurredAt: new Date().toISOString(), apiVersion: 'v2', ...(correlationId ? { correlationId: correlationId.slice(0, 100) } : {}), data: { ...(event.data ?? {}), ...(event.extra && Object.keys(event.extra).length ? { dataJson: JSON.stringify(event.extra) } : {}) } }
    }, correlationId, { ownerId, role: 'system', scopes: new Set() });
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    logger.warn(`event ${event.eventType} not published code=${typeof code === 'number' ? code : 'unknown'}`);
  }
}
