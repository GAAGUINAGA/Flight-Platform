/** Dominio del bus de eventos (ADR-F12b-04/05): nombres de la topología, sobre CloudEvents y política de reintento. Sin Nest, Prisma ni amqplib. */

export const EVENTS_EXCHANGE = 'flight.events';
export const WEBHOOKS_QUEUE = 'q.webhooks.entrega';
export const WEBHOOKS_FAILED_QUEUE = `${WEBHOOKS_QUEUE}.fallidos`;
export const waitQueueName = (queue: string, step: number): string => `${queue}.espera.${step}`;
/** La cola principal recibe cualquier evento de estas familias (la clave de enrutamiento es el `eventType`). */
export const WEBHOOKS_BINDINGS = ['booking.#', 'hold.#', 'flight.#'] as const;
export const CLOUD_EVENT_TYPE_PREFIX = 'ec.edu.epn.booking.vuelos.';
export const EVENT_SOURCE = '/gabatair/esb';
export const DEFAULT_RETRY_TTLS_MS: readonly number[] = [30_000, 120_000, 600_000];

/** El broker no respondió (conexión rechazada o plazo vencido). Los eventos siguen en la outbox. */
export class BusUnavailableError extends Error {
  constructor() { super('event bus unavailable'); this.name = 'BusUnavailableError'; }
}

export interface QueueSpec { name: string; durable: true; args?: Record<string, string | number>; bindings?: readonly string[] }
export interface Topology { exchange: string; queues: QueueSpec[] }

/** Topología completa de un propósito: cola principal, una cola de espera por intento (TTL, dead-letter a la principal) y cola de fallidos. */
export function topologyFor(queue: string, bindings: readonly string[], retryTtlsMs: readonly number[], exchange: string = EVENTS_EXCHANGE): Topology {
  return {
    exchange,
    queues: [
      { name: queue, durable: true, bindings },
      ...retryTtlsMs.map((ttl, index) => ({ name: waitQueueName(queue, index + 1), durable: true as const, args: { 'x-message-ttl': ttl, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue } })),
      { name: `${queue}.fallidos`, durable: true }
    ]
  };
}

export interface EventPayload { eventId: string; eventType: string; occurredAt: string; apiVersion?: string; correlationId?: string; data?: Record<string, unknown> }
export interface CloudEventEnvelope {
  specversion: '1.0'; id: string; type: string; source: string; time: string; datacontenttype: 'application/json'; correlationid: string;
  data: { ownerId: string; payload: EventPayload };
}

/** CloudEvents 1.0 interno del bus. `data` es el mismo `ownerId` + `payload` del PublishEvent actual, para que Webhooks reutilice su caso de uso. */
export function buildEnvelope(ownerId: string, payload: EventPayload): CloudEventEnvelope {
  return {
    specversion: '1.0', id: payload.eventId, type: `${CLOUD_EVENT_TYPE_PREFIX}${payload.eventType}`, source: EVENT_SOURCE, time: payload.occurredAt,
    datacontenttype: 'application/json', correlationid: payload.correlationId ?? payload.eventId, data: { ownerId, payload }
  };
}

/** Espera antes de reintentar publicar cuando el broker falla: 5 s, 10 s, 20 s… con tope de 5 min. `attempts` ya incluye el intento fallido. */
export function publishBackoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(attempts - 1, 0), 300_000);
}

export type RetryDecision = { action: 'retry'; queue: string; attempt: number } | { action: 'fail'; queue: string };
/** Decisión del consumidor ante un fallo: un error no reintentable o el último intento van a fallidos; si no, a la siguiente espera. */
export function retryDecision(queue: string, attempt: number, maxAttempts: number, retryable: boolean): RetryDecision {
  if (!retryable || attempt >= maxAttempts) return { action: 'fail', queue: `${queue}.fallidos` };
  return { action: 'retry', queue: waitQueueName(queue, attempt + 1), attempt: attempt + 1 };
}
