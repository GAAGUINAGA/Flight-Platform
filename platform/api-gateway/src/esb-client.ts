/* global fetch, AbortController */
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import { status } from '@grpc/grpc-js';
import type { GatewayConfig } from './config';
import type { AuthContext } from './auth';
import { ESB_OPERATIONS } from './esb-operations';

/** Plazos que usaba el transporte gRPC: 5 s, o `GATEWAY_ORCHESTRATION_DEADLINE_MS` (30 s) en las cuatro operaciones orquestadas de Reservation. */
const DEFAULT_DEADLINE_MS = 5_000;
const ORCHESTRATED = new Set(['createReservation', 'addBaggage', 'confirmDateChange', 'cancelReservation']);
/** Margen para que el ESB responda su propio 504 antes de que el Gateway aborte la conexión. */
const ABORT_MARGIN_MS = 1_000;

export function deadlineFor(service: string, method: string, env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.GATEWAY_ORCHESTRATION_DEADLINE_MS ?? 30_000);
  return service === 'reservation' && ORCHESTRATED.has(method) && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DEADLINE_MS;
}

/** Error con la misma forma que el de un cliente gRPC (`code` numérico y `details` = código del catálogo): `asProblem` no cambia (ADR-F12b-02). */
export class EsbCallError extends Error {
  constructor(readonly code: number, readonly details: string | undefined, readonly step?: string) { super(`ESB ${status[code] ?? 'ERROR'}`); }
}

interface Envelope { ok: boolean; result?: unknown; error?: { source?: string; grpcCode?: number; catalogCode?: string | null; step?: string } }

/** Un error propio del ESB (llave, operación, sobre, falla interna) no es culpa del cliente: llega como INTERNAL. */
export function errorFromEnvelope(body: Envelope | undefined): EsbCallError {
  const error = body?.error;
  if (!error || typeof error.grpcCode !== 'number') return new EsbCallError(status.INTERNAL, undefined);
  if (error.source !== 'service') {
    // Salvo plazo vencido o servicio no disponible, que son transitorios y siguen siendo 503 con Retry-After.
    return new EsbCallError(error.grpcCode === status.DEADLINE_EXCEEDED || error.grpcCode === status.UNAVAILABLE ? error.grpcCode : status.INTERNAL, undefined);
  }
  return new EsbCallError(error.grpcCode, error.catalogCode ?? undefined, error.step);
}

export interface EsbCall { operation: string; input: object; correlationId: string; auth?: AuthContext; deadlineMs: number; abortMarginMs?: number }

/** Llama a una operación con nombre del ESB (ADR-F12b-02) y devuelve su `result` o lanza un error con forma de error gRPC. */
export async function callEsbOperation(config: GatewayConfig, call: EsbCall): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.deadlineMs + (call.abortMarginMs ?? ABORT_MARGIN_MS));
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-internal-key': config.internalApiKey, 'x-correlation-id': call.correlationId || 'gateway', 'x-deadline-ms': String(call.deadlineMs) };
    if (call.auth?.ownerId) headers['x-owner-id'] = call.auth.ownerId;
    if (call.auth?.role) headers['x-role'] = call.auth.role;
    const response = await fetch(`${config.esbUrl}/internal/v1/operations/${call.operation}`, { method: 'POST', headers, body: JSON.stringify({ input: call.input }), signal: controller.signal });
    const body = await response.json().catch(() => undefined) as Envelope | undefined;
    if (response.ok && body?.ok) return body.result;
    throw errorFromEnvelope(body);
  } catch (error) {
    if (error instanceof EsbCallError) throw error;
    // ESB inaccesible, conexión rechazada o abortada por el plazo: transitorio ⇒ 503 con Retry-After, como la caída de un servicio.
    const aborted = typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
    throw new EsbCallError(aborted ? status.DEADLINE_EXCEEDED : status.UNAVAILABLE, undefined);
  } finally { clearTimeout(timer); }
}

/** Equivalente de `callGatewayGrpc` por el ESB. */
export async function callEsb(config: GatewayConfig, service: string, method: string, request: object, correlationId: string, auth?: AuthContext): Promise<unknown> {
  const operation = ESB_OPERATIONS[`${service}.${method}`];
  if (!operation) throw new Error('Unknown ESB operation');
  return callEsbOperation(config, { operation, input: request, correlationId, auth, deadlineMs: deadlineFor(service, method) });
}
