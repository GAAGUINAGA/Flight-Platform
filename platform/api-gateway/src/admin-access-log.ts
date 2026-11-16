import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/prisma-client';

/** Acciones y resultados del registro del administrador (F12c-4, ADR-F12c4-01). Nunca datos de la reserva. */
export const ADMIN_ACTIONS = ['SEARCH_PNR', 'CHECK_IN', 'BOARDING_PASSES', 'CREATE_FLIGHT', 'OPEN_FLIGHT'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export const ADMIN_RESULTS = ['FOUND', 'NOT_FOUND', 'INVALID_FORMAT', 'OK', 'REJECTED', 'ERROR', 'RATE_LIMITED'] as const;
export type AdminResult = (typeof ADMIN_RESULTS)[number];
/**
 * LISTA CERRADA de `error_code` (códigos del catálogo de errores que pueden ocurrir aquí). Jamás se copia texto de `details`, `message` ni de ningún campo
 * de un error: lo que no esté en la lista se guarda como `UNKNOWN_ERROR`.
 */
export const ADMIN_ERROR_CODES = [
  'NOT_FOUND', 'VALIDATION_FAILED', 'RATE_LIMIT_EXCEEDED', 'UNAUTHORIZED', 'FORBIDDEN', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'PROVIDER_UNAVAILABLE', 'INTERNAL_ERROR', 'UNKNOWN_ERROR',
  // F12c-4b/4c: reglas de negocio del check-in y de la creación de vuelos (lista cerrada; nunca texto del error).
  'BOOKING_NOT_CONFIRMED', 'CHECK_IN_NOT_AVAILABLE', 'CHECK_IN_FAILED', 'BOARDING_PASS_NOT_AVAILABLE', 'FLIGHT_ALREADY_DEPARTED', 'FLIGHT_ALREADY_EXISTS', 'FLIGHT_NOT_READY', 'IDEMPOTENCY_KEY_REUSED'
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

/** Alfabeto real de `createPnr` (Reservation): sin I, O, 0 ni 1. */
export const PNR_FORMAT = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
/** Un PNR con el formato de la plataforma; solo `asPnr` lo produce, de modo que `subject` no admite texto libre. */
export type Pnr = string & { readonly __pnr: true };
export const asPnr = (value: unknown): Pnr | null => (typeof value === 'string' && PNR_FORMAT.test(value) ? (value as Pnr) : null);

/** Número de vuelo con el formato de la plataforma (sujeto de CREATE_FLIGHT); solo `asFlightNumber` lo produce. */
export const FLIGHT_NUMBER_FORMAT = /^[A-Z0-9]{2}[0-9]{1,4}$/;
export type FlightNumber = string & { readonly __flightNumber: true };
export const asFlightNumber = (value: unknown): FlightNumber | null => (typeof value === 'string' && FLIGHT_NUMBER_FORMAT.test(value) ? (value as FlightNumber) : null);
/** Id de una instancia de vuelo (UUID; sujeto de OPEN_FLIGHT); solo `asFlightInstanceRef` lo produce. */
export type FlightInstanceRef = string & { readonly __flightInstanceRef: true };
export const asFlightInstanceRef = (value: unknown): FlightInstanceRef | null => (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? (value as FlightInstanceRef) : null);
/** Lo único que puede ser el sujeto de una fila: un PNR, un número de vuelo o un id de instancia (todos validados), nunca texto libre. */
export type AdminSubject = Pnr | FlightNumber | FlightInstanceRef;

const CLOSED = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
/** Códigos de estado gRPC → código del catálogo (la tabla es fija; no depende de ningún texto del error). */
const GRPC_TO_CATALOG: Readonly<Record<number, AdminErrorCode>> = { 3: 'VALIDATION_FAILED', 4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND', 7: 'FORBIDDEN', 8: 'RATE_LIMIT_EXCEEDED', 13: 'INTERNAL_ERROR', 14: 'UNAVAILABLE', 16: 'UNAUTHORIZED' };
/** Único traductor de un error cualquiera a un valor de la lista cerrada: solo mira `code` (texto de catálogo o número gRPC), nunca `details` ni `message`. */
export function adminErrorCode(error: unknown): AdminErrorCode {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (CLOSED(ADMIN_ERROR_CODES, code)) return code;
  if (typeof code !== 'number') return 'UNKNOWN_ERROR';
  if (GRPC_TO_CATALOG[code]) return GRPC_TO_CATALOG[code];
  // Un error de negocio llega como estado gRPC genérico + código del catálogo en `details`: solo vale si ES un valor de la lista cerrada (cualquier otro texto se descarta).
  const details = (error as { details?: unknown }).details;
  return CLOSED(ADMIN_ERROR_CODES, details) ? details : 'UNKNOWN_ERROR';
}

/** Lo que un llamador puede pedir registrar: solo valores de listas cerradas (a nivel de tipos) y un PNR válido o nulo. */
export interface AdminAccessEntry { actorSub: string; action: AdminAction; subject?: AdminSubject | null; result: AdminResult; errorCode?: AdminErrorCode | null; correlationId?: string | null }
export interface AdminAccessRow extends AdminAccessEntry { id: string; at: Date }
/** La fila exacta que se guarda. */
export interface AdminAccessFields { actorSub: string; action: AdminAction; subject: AdminSubject | null; result: AdminResult; errorCode: AdminErrorCode | null; correlationId: string | null }

/**
 * ÚNICO lugar que construye la fila del registro. Los tipos ya impiden el texto libre; esto lo garantiza también en ejecución (un `as`, JS o un valor
 * leído de un servicio no lo evaden): `result` y `action` fuera de lista ⇒ error de programación; `errorCode` fuera de lista ⇒ `UNKNOWN_ERROR`;
 * `subject` que no sea un PNR válido ⇒ nulo.
 */
export function buildAccessRow(entry: AdminAccessEntry): AdminAccessFields {
  if (!CLOSED(ADMIN_ACTIONS, entry.action) || !CLOSED(ADMIN_RESULTS, entry.result)) throw new Error('admin access log: action or result outside the closed list');
  const errorCode = entry.errorCode === null || entry.errorCode === undefined ? null : CLOSED(ADMIN_ERROR_CODES, entry.errorCode) ? entry.errorCode : 'UNKNOWN_ERROR';
  // El sujeto se valida según la acción: PNR (búsqueda, check-in, pases), número de vuelo (crear) o id de instancia (abrir); cualquier otra cosa ⇒ nulo.
  const subject = entry.action === 'CREATE_FLIGHT' ? asFlightNumber(entry.subject) : entry.action === 'OPEN_FLIGHT' ? asFlightInstanceRef(entry.subject) : asPnr(entry.subject);
  return { actorSub: entry.actorSub, action: entry.action, subject, result: entry.result, errorCode, correlationId: entry.correlationId ?? null };
}

/** Solo inserta y lee (el rol del Gateway no tiene UPDATE ni DELETE). Un fallo al escribir debe impedir devolver datos (falla cerrada). */
export interface AdminAccessLog {
  record(entry: AdminAccessEntry): Promise<void>;
  /** Intentos del administrador desde `since`, sin contar los rechazados por el propio límite (para que el bloqueo termine). */
  countSince(actorSub: string, action: AdminAction, since: Date): Promise<number>;
}

export class InMemoryAdminAccessLog implements AdminAccessLog {
  readonly rows: AdminAccessRow[] = [];
  async record(entry: AdminAccessEntry): Promise<void> { this.rows.push({ ...buildAccessRow(entry), id: randomUUID(), at: new Date() }); }
  async countSince(actorSub: string, action: AdminAction, since: Date): Promise<number> {
    return this.rows.filter((row) => row.actorSub === actorSub && row.action === action && row.result !== 'RATE_LIMITED' && row.at >= since).length;
  }
}

export class PrismaAdminAccessLog implements AdminAccessLog {
  constructor(private readonly prisma: PrismaClient) {}
  async record(entry: AdminAccessEntry): Promise<void> {
    await this.prisma.adminAccessLog.create({ data: buildAccessRow(entry) });
  }
  async countSince(actorSub: string, action: AdminAction, since: Date): Promise<number> {
    return this.prisma.adminAccessLog.count({ where: { actorSub, action, at: { gte: since }, NOT: { result: 'RATE_LIMITED' } } });
  }
}
