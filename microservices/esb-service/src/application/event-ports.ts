import type { CloudEventEnvelope } from '../domain/events';

/** Fila reclamada de la outbox. `attempts` ya incluye el intento en curso. */
export interface OutboxRow { seq: number; eventId: string; routingKey: string; envelope: CloudEventEnvelope; attempts: number }
export interface NewOutboxEvent { eventId: string; routingKey: string; ownerId: string; envelope: CloudEventEnvelope }
export interface ReleasedRow { seq: number; errorCode: string; availableAt: Date }

/** Puerto de la outbox (esquema `esb`). Todas las operaciones son idempotentes o atómicas por sentencia. */
export interface EventOutbox {
  /** `false` si el `eventId` ya estaba (ingreso repetido). */
  insert(event: NewOutboxEvent, now: Date): Promise<boolean>;
  /** Reclama hasta `limit` filas pendientes y disponibles, en orden de `seq`, con arriendo de `leaseMs` (varias instancias no se pisan). */
  claim(now: Date, limit: number, leaseMs: number): Promise<OutboxRow[]>;
  markPublished(seqs: number[], now: Date): Promise<void>;
  /** Devuelve filas al estado pendiente, sin arriendo, con su próxima disponibilidad. */
  release(rows: ReleasedRow[]): Promise<void>;
  purgePublished(before: Date, limit: number): Promise<number>;
  pendingCount(): Promise<number>;
}

export interface PublishReport { published: number[]; failed: Array<{ seq: number; code: string }> }
/** Sesión de publicación sobre una conexión abierta al broker. */
export interface BusSession { publish(rows: OutboxRow[]): Promise<PublishReport>; close(): Promise<void> }
export interface EventBus {
  /** Abre una conexión con plazo. Lanza `BusUnavailableError` si el broker no responde. */
  open(): Promise<BusSession>;
  /** Solo para diagnóstico de salud: ¿responde el broker? */
  ping(): Promise<boolean>;
}

/** Lo que el ESB expone a la mediación para los eventos. Los fallos se lanzan como `{code, details}` (misma forma que gRPC). */
export interface EventOperations {
  ingest(input: Record<string, unknown>): Promise<{ eventId: string }>;
  publishOutbox(deadlineAt: Date): Promise<{ claimed: number; published: number; pending: number; brokerAvailable: boolean }>;
}
