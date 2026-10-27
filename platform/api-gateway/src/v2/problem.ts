import { status as grpcStatus } from '@grpc/grpc-js';
import { HttpException } from '@nestjs/common';

// Duck typing: `web-errors` importa este módulo y un import directo de GatewayProblemError sería circular.
const isGatewayProblem = (error: unknown): error is { statusCode: number; code: string; safeDetail?: string } =>
  error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === 'number' && typeof (error as { code?: unknown }).code === 'string' && error.constructor.name === 'GatewayProblemError';

/** Códigos del enum `ProblemDetails.code` del contrato v2 y el HTTP con el que el contrato los lista. */
export const V2_PROBLEM_STATUS: Readonly<Record<string, number>> = {
  VALIDATION_FAILED: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, RATE_LIMIT_EXCEEDED: 429, IDEMPOTENCY_KEY_REUSED: 409, INTERNAL_ERROR: 500, PROVIDER_UNAVAILABLE: 503,
  OFFER_NO_LONGER_AVAILABLE: 410, HOLD_EXPIRED: 410, HOLD_ALREADY_CONSUMED: 409, SEAT_TAKEN: 409, SEAT_CABIN_MISMATCH: 422, INFANT_SEAT_NOT_ALLOWED: 422,
  INFANT_WITHOUT_ADULT: 422, PASSENGER_COUNT_MISMATCH: 422, DOCUMENT_EXPIRED: 422, PASSPORT_REQUIRED_INTERNATIONAL: 422,
  PAYMENT_REFERENCE_INVALID: 422, PAYMENT_NOT_AUTHORIZED: 422, AMOUNT_MISMATCH: 422,
  PNR_CREATION_FAILED: 500, BOOKING_NOT_CONFIRMED: 409, TICKET_ISSUANCE_FAILED: 500, TICKET_ALREADY_ISSUED: 409,
  BAGGAGE_LIMIT_EXCEEDED: 422, FARE_NOT_CHANGEABLE: 409, CHANGE_OFFER_EXPIRED: 410, QUOTE_EXPIRED: 409, ALREADY_CANCELLED: 409, BOOKING_NOT_CANCELLABLE: 409, CUTOFF_PASSED: 409,
  CHECK_IN_NOT_AVAILABLE: 409, CHECK_IN_FAILED: 422, BOARDING_PASS_NOT_AVAILABLE: 409, FLIGHT_ALREADY_DEPARTED: 409, FLIGHT_CANCELLED: 409, FLIGHT_STATUS_NOT_AVAILABLE: 404, INVALID_STATUS_TRANSITION: 409,
  PROMOTION_DISCOUNT_OUT_OF_RANGE: 422
};

const TITLES: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Solicitud inválida', UNAUTHORIZED: 'No autenticado', FORBIDDEN: 'Acceso denegado', NOT_FOUND: 'No encontrado', RATE_LIMIT_EXCEEDED: 'Demasiadas solicitudes',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency-Key reutilizada', INTERNAL_ERROR: 'Error interno', PROVIDER_UNAVAILABLE: 'Proveedor no disponible', HOLD_EXPIRED: 'Hold vencido', HOLD_ALREADY_CONSUMED: 'Hold ya consumido'
};

export interface V2Problem { type: string; title: string; status: number; code: string; detail?: string; instance?: string; correlation_id?: string; timestamp: string; invalidParams?: Array<{ name: string; reason: string }>; }
export interface V2RequestInfo { method: string; path: string; correlationId?: string; }

export const isV2Path = (path: string): boolean => path === '/api/v2' || path.startsWith('/api/v2/');

const kebab =(code: string): string => code.toLowerCase().replace(/_/g, '-');

export function buildV2Problem(code: string, request: V2RequestInfo, options: { status?: number; detail?: string; invalidParams?: V2Problem['invalidParams'] } = {}): V2Problem {
  const known = code in V2_PROBLEM_STATUS;
  const finalCode = known ? code : 'INTERNAL_ERROR';
  const status = options.status ?? V2_PROBLEM_STATUS[finalCode];
  return {
    type: `https://flight-platform.dev/problems/${kebab(finalCode)}`, title: TITLES[finalCode] ?? finalCode, status, code: finalCode,
    ...(options.detail ? { detail: options.detail } : {}), instance: request.path, ...(request.correlationId ? { correlation_id: request.correlationId } : {}),
    timestamp: new Date().toISOString(), ...(options.invalidParams?.length ? { invalidParams: options.invalidParams } : {})
  };
}

const codeForStatus = (status: number): string => status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMIT_EXCEEDED' : status === 503 ? 'PROVIDER_UNAVAILABLE' : status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';

/** Traduce cualquier error del Gateway a ProblemDetails v2 sin filtrar detalles internos ni valores del usuario. */
export function v2ProblemFromError(error: unknown, request: V2RequestInfo): V2Problem {
  if (isGatewayProblem(error)) {
    // Los guards de v1 lanzan VALIDATION_FAILED con 401/403: en v2 son UNAUTHORIZED/FORBIDDEN.
    const code = error.code in V2_PROBLEM_STATUS && !(error.code === 'VALIDATION_FAILED' && error.statusCode !== 400) ? error.code : codeForStatus(error.statusCode);
    return buildV2Problem(code, request, { status: error.statusCode, detail: error.safeDetail });
  }
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number') {
    const details = (error as { details?: unknown }).details;
    const grpc = error.code;
    if (grpc === grpcStatus.UNAVAILABLE || grpc === grpcStatus.DEADLINE_EXCEEDED) return buildV2Problem('PROVIDER_UNAVAILABLE', request, { detail: 'Servicio temporalmente no disponible' });
    if (grpc === grpcStatus.UNAUTHENTICATED) return buildV2Problem('UNAUTHORIZED', request);
    if (grpc === grpcStatus.PERMISSION_DENIED) return buildV2Problem('FORBIDDEN', request);
    // Un código del catálogo manda sobre el estado gRPC (p. ej. BOARDING_PASS_NOT_AVAILABLE llega como NOT_FOUND pero el contrato lo lista como 409).
    if (typeof details === 'string' && details in V2_PROBLEM_STATUS) return buildV2Problem(details, request);
    if (grpc === grpcStatus.NOT_FOUND) return buildV2Problem('NOT_FOUND', request, { detail: 'Recurso no encontrado' });
    if (grpc === grpcStatus.INVALID_ARGUMENT) return buildV2Problem('VALIDATION_FAILED', request);
    return buildV2Problem('INTERNAL_ERROR', request, { detail: 'Ocurrió un error inesperado' });
  }
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status: unknown }).status === 'number' ? (error as { status: number }).status
    : error instanceof HttpException ? error.getStatus() : undefined;
  if (status !== undefined) {
    if (status === 401 || status === 403 || status === 404 || status === 405) return buildV2Problem(codeForStatus(status), request, { status, detail: status === 404 ? 'Recurso no encontrado' : undefined });
    if (status === 413 || status === 415) return buildV2Problem('VALIDATION_FAILED', request, { status, detail: 'La solicitud no se pudo procesar' });
    if (status >= 400 && status < 500) return buildV2Problem('VALIDATION_FAILED', request, { status: 400, detail: 'La solicitud no se pudo procesar' });
  }
  return buildV2Problem('INTERNAL_ERROR', request, { detail: 'Ocurrió un error inesperado' });
}
