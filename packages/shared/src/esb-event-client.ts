/* global fetch, AbortController, Response */
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

/**
 * Cliente HTTP mínimo hacia el ESB para publicar eventos (F12b-2, ADR-F12b-04). Los servicios emisores ya no llaman a Webhooks:
 * mandan el mismo mensaje `PublishEvent` a la operación `clientes.publicar-evento` del ESB, que lo guarda en su outbox.
 * Los fallos se lanzan como `{ code }` numérico (UNAVAILABLE 14, DEADLINE_EXCEEDED 4 o el código gRPC que devolvió el ESB)
 * para que los envoltorios de cada servicio (`SafeEventPublisher`, `readDependency`) se comporten igual que con gRPC.
 */
export const ESB_PUBLISH_EVENT_OPERATION = 'clientes.publicar-evento';
const UNAVAILABLE = 14; const DEADLINE_EXCEEDED = 4; const INTERNAL = 13;

export interface EsbEventClientOptions {
  /** Origen del ESB, p. ej. `http://127.0.0.1:3100` (sin ruta). */
  baseUrl: string;
  internalApiKey: string;
  /** Correlación por defecto cuando el evento no trae `payload.correlationId`. */
  correlationId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}
export interface EsbEventInput { ownerId: string; payload: { correlationId?: string; [key: string]: unknown } }

const failure = (code: number, details?: string): Error => Object.assign(new Error('event publish to ESB failed'), { code, ...(details ? { details } : {}) });

export class EsbEventClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: EsbEventClientOptions) {
    const base = options.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+$/.test(base)) throw new Error('ESB_URL must be an origin without path');
    this.url = `${base}/internal/v1/operations/${ESB_PUBLISH_EVENT_OPERATION}`;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Publica el evento. Devuelve el `eventId` asignado. */
  async publish(input: EsbEventInput): Promise<{ eventId?: string }> {
    const correlationId = (typeof input.payload.correlationId === 'string' && input.payload.correlationId) || this.options.correlationId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-internal-key': this.options.internalApiKey, 'x-correlation-id': correlationId.replace(/[^\x21-\x7e]/g, '').slice(0, 128) || this.options.correlationId, 'x-owner-id': input.ownerId.slice(0, 255), 'x-role': 'system', 'x-deadline-ms': String(this.timeoutMs) },
        body: JSON.stringify({ input })
      });
    } catch (thrown) {
      throw failure(controller.signal.aborted || (thrown instanceof Error && thrown.name === 'AbortError') ? DEADLINE_EXCEEDED : UNAVAILABLE);
    } finally { clearTimeout(timer); }
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const parsed = body as { ok?: boolean; result?: { eventId?: string }; error?: { source?: string; grpcCode?: number; catalogCode?: string | null } } | undefined;
    if (response.ok && parsed?.ok === true) return { eventId: parsed.result?.eventId };
    const error = parsed?.error;
    // Un error del propio ESB (llave, configuración) no es culpa del evento: se informa como INTERNAL, igual que el Gateway.
    if (!error || error.source === 'esb') throw failure(response.status === 503 ? UNAVAILABLE : response.status === 504 ? DEADLINE_EXCEEDED : INTERNAL);
    throw failure(typeof error.grpcCode === 'number' ? error.grpcCode : INTERNAL, error.catalogCode ?? undefined);
  }

}

/**
 * Aviso de arranque (condición de ADR-F12b2-01): en producción, un emisor sin `ESB_URL` publica por gRPC directo a Webhooks, sin el bus.
 * Devuelve el aviso (o `undefined`) y lo escribe en stderr como una línea JSON, sin valores de configuración.
 */
export function warnIfEventBusBypassed(env: Record<string, string | undefined>, service: string, write: (line: string) => void = (line) => { process.stderr.write(line); }): string | undefined {
  if (env.NODE_ENV !== 'production' || env.ESB_URL) return undefined;
  const message = `${service}: ESB_URL is not set in production; events are published by direct gRPC to Webhooks, bypassing the event bus (outbox and RabbitMQ)`;
  write(`${JSON.stringify({ level: 'warn', service, dependency: 'event-bus', message })}\n`);
  return message;
}

/** Crea el cliente desde el entorno (`ESB_URL`, `INTERNAL_API_KEY`). Falla rápido si falta `ESB_URL`. */
export function esbEventClientFromEnv(env: Record<string, string | undefined>, internalApiKey: string, correlationId: string): EsbEventClient {
  const baseUrl = env.ESB_URL;
  if (!baseUrl) throw new Error('ESB_URL is required');
  const timeout = env.ESB_EVENT_TIMEOUT_MS ? Number(env.ESB_EVENT_TIMEOUT_MS) : undefined;
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout <= 0)) throw new Error('ESB_EVENT_TIMEOUT_MS must be a positive integer');
  return new EsbEventClient({ baseUrl, internalApiKey, correlationId, timeoutMs: timeout });
}
