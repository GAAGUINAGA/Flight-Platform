import type { ErrorCategory } from '@flight-platform/graphql-schema/generated/types';

/**
 * Errores de la capa de datos (diseño F12c-0 §6.3). La pantalla decide QUÉ HACER por `category` y `code`, nunca por el texto.
 * El mensaje sale de este catálogo en español (sin valores del usuario); el `correlationId` se muestra en «Detalles» para soporte.
 */
export type { ErrorCategory };
export interface InvalidParam { name: string; reason?: string }

export interface AppErrorInit {
  category: ErrorCategory; code: string; correlationId?: string | null; retryAfterSeconds?: number | null; invalidParams?: InvalidParam[]; httpStatus?: number | null;
}

export class AppError extends Error {
  readonly category: ErrorCategory; readonly code: string; readonly correlationId: string | null; readonly retryAfterSeconds: number | null;
  readonly invalidParams: InvalidParam[]; readonly httpStatus: number | null;
  constructor(init: AppErrorInit) {
    super(messageFor(init.code, init.category));
    this.name = 'AppError'; this.category = init.category; this.code = init.code; this.correlationId = init.correlationId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null; this.invalidParams = init.invalidParams ?? []; this.httpStatus = init.httpStatus ?? null;
  }
}

export const CATEGORIES: readonly ErrorCategory[] = ['VALIDATION', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'GONE', 'UNPROCESSABLE', 'RATE_LIMITED', 'UNAVAILABLE', 'INTERNAL'];
export const isCategory = (value: unknown): value is ErrorCategory => typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);

/** Códigos propios del cliente (no vienen del servicio). */
export const CLIENT_CODES = { network: 'NETWORK_ERROR', timeout: 'CLIENT_TIMEOUT', badResponse: 'BAD_RESPONSE' } as const;

/** Mensajes por `code`. Los códigos del contrato v2 (§6.3) que no usa esta entrega también están: llegan igual desde el servicio. */
const MESSAGES: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Revisa los datos ingresados.',
  UNAUTHENTICATED: 'Inicia sesión para continuar.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  NOT_FOUND: 'No encontramos lo que buscas.',
  RATE_LIMIT_EXCEEDED: 'Hiciste demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  IDEMPOTENCY_KEY_REUSED: 'Esta operación ya se está procesando o se envió con otros datos.',
  INTERNAL_ERROR: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
  PROVIDER_UNAVAILABLE: 'El servicio no está disponible por ahora. Inténtalo en unos segundos.',
  GATEWAY_UNAVAILABLE: 'No pudimos comunicarnos con el servicio. Inténtalo en unos segundos.',
  OFFER_NO_LONGER_AVAILABLE: 'Esa oferta ya no está disponible. Realiza una nueva búsqueda.',
  HOLD_EXPIRED: 'El tiempo para completar la compra venció. Realiza una nueva búsqueda.',
  HOLD_ALREADY_CONSUMED: 'Esa selección ya se convirtió en una reserva.',
  SEAT_TAKEN: 'Ese asiento acaba de ser ocupado. Elige otro.',
  SEAT_CABIN_MISMATCH: 'Ese asiento no pertenece a la cabina elegida.',
  INFANT_SEAT_NOT_ALLOWED: 'Los infantes no ocupan asiento.',
  INFANT_WITHOUT_ADULT: 'Cada infante debe viajar con un adulto.',
  PASSENGER_COUNT_MISMATCH: 'La cantidad de pasajeros no coincide con la selección.',
  DOCUMENT_EXPIRED: 'El documento de uno de los pasajeros está vencido.',
  PASSPORT_REQUIRED_INTERNATIONAL: 'Los vuelos internacionales requieren pasaporte.',
  PAYMENT_REFERENCE_INVALID: 'La referencia de pago no es válida.',
  PAYMENT_NOT_AUTHORIZED: 'El pago no fue autorizado.',
  AMOUNT_MISMATCH: 'El monto del pago no coincide con el total.',
  PNR_CREATION_FAILED: 'No pudimos crear la reserva. Inténtalo de nuevo.',
  BOOKING_NOT_CONFIRMED: 'La reserva todavía no está confirmada.',
  TICKET_ISSUANCE_FAILED: 'No pudimos emitir los boletos. Reintenta la emisión.',
  TICKET_ALREADY_ISSUED: 'Los boletos ya fueron emitidos.',
  BAGGAGE_LIMIT_EXCEEDED: 'Superaste el máximo de maletas permitido.',
  FARE_NOT_CHANGEABLE: 'Esta tarifa no permite cambios.',
  CHANGE_OFFER_EXPIRED: 'La oferta de cambio venció. Búscala de nuevo.',
  QUOTE_EXPIRED: 'La cotización venció. Solicítala de nuevo.',
  ALREADY_CANCELLED: 'La reserva ya está cancelada.',
  BOOKING_NOT_CANCELLABLE: 'La reserva no se puede cancelar en su estado actual.',
  CUTOFF_PASSED: 'Ya pasó el plazo para esta operación.',
  CHECK_IN_NOT_AVAILABLE: 'El check-in no está disponible todavía.',
  CHECK_IN_FAILED: 'No pudimos completar el check-in.',
  BOARDING_PASS_NOT_AVAILABLE: 'El pase de abordar aún no está disponible.',
  FLIGHT_ALREADY_DEPARTED: 'El vuelo ya salió.',
  FLIGHT_CANCELLED: 'El vuelo fue cancelado.',
  FLIGHT_STATUS_NOT_AVAILABLE: 'No encontramos ese vuelo en esa fecha. La fecha es la de salida, en hora del aeropuerto de origen.',
  INVALID_STATUS_TRANSITION: 'Ese cambio de estado del vuelo no es válido.',
  PROMOTION_DISCOUNT_OUT_OF_RANGE: 'El descuento debe estar entre 0 y 100.',
  UNKNOWN_GATEWAY_ERROR: 'No pudimos completar la operación.',
  GRAPHQL_VALIDATION_FAILED: 'No pudimos procesar la solicitud. Revisa los datos ingresados.',
  GRAPHQL_OPERATION_NOT_ALLOWED: 'Esta versión de la aplicación ya no es compatible. Recarga la página.',
  GRAPHQL_QUERY_TOO_COMPLEX: 'No pudimos procesar la solicitud.',
  GRAPHQL_PARSE_FAILED: 'No pudimos procesar la solicitud.',
  GRAPHQL_BAD_REQUEST: 'No pudimos procesar la solicitud.',
  GRAPHQL_TIMEOUT: 'La operación tardó demasiado. Inténtalo de nuevo.',
  PAYLOAD_TOO_LARGE: 'La solicitud es demasiado grande.',
  [CLIENT_CODES.network]: 'No pudimos conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.',
  [CLIENT_CODES.timeout]: 'El servicio está tardando más de lo normal. Inténtalo de nuevo en un momento.',
  [CLIENT_CODES.badResponse]: 'Recibimos una respuesta que no pudimos interpretar. Inténtalo de nuevo.'
};

/** Mensaje de respaldo por categoría para un `code` que el catálogo no conoce. */
const BY_CATEGORY: Readonly<Record<ErrorCategory, string>> = {
  VALIDATION: 'Revisa los datos ingresados.',
  UNAUTHENTICATED: 'Inicia sesión para continuar.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  NOT_FOUND: 'No encontramos lo que buscas.',
  CONFLICT: 'No pudimos completar la operación en el estado actual.',
  GONE: 'Esa información ya venció. Vuelve a intentarlo desde el inicio.',
  UNPROCESSABLE: 'No pudimos procesar los datos enviados.',
  RATE_LIMITED: 'Hiciste demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  UNAVAILABLE: 'El servicio no está disponible por ahora. Inténtalo en unos segundos.',
  INTERNAL: 'Ocurrió un error inesperado. Inténtalo de nuevo.'
};

export const knownCodes = (): string[] => Object.keys(MESSAGES);
export function messageFor(code: string, category: ErrorCategory): string {
  return MESSAGES[code] ?? BY_CATEGORY[category];
}

/** Qué ofrece la pantalla ante el error. Se decide por categoría y, donde hace falta, por código. */
export type ErrorAction = 'retry' | 'wait' | 'login' | 'search-again' | 'fix-input' | 'go-home' | 'reload' | 'none';

const SEARCH_AGAIN = new Set(['OFFER_NO_LONGER_AVAILABLE', 'HOLD_EXPIRED', 'CHANGE_OFFER_EXPIRED']);

export function actionFor(error: Pick<AppError, 'category' | 'code'>): ErrorAction {
  if (error.code === 'GRAPHQL_OPERATION_NOT_ALLOWED') return 'reload';
  if (SEARCH_AGAIN.has(error.code)) return 'search-again';
  switch (error.category) {
    case 'UNAUTHENTICATED': return 'login';
    case 'FORBIDDEN': return 'go-home';
    case 'VALIDATION': case 'UNPROCESSABLE': return 'fix-input';
    case 'RATE_LIMITED': return 'wait';
    case 'UNAVAILABLE': case 'INTERNAL': return 'retry';
    case 'GONE': return 'search-again';
    case 'NOT_FOUND': case 'CONFLICT': return 'none';
  }
}

/** ¿Se puede reintentar SOLO una lectura? Únicamente la indisponibilidad transitoria (diseño §9.1). */
export const isTransient = (error: unknown): boolean => error instanceof AppError && error.category === 'UNAVAILABLE';

export function toAppError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError({ category: 'INTERNAL', code: 'INTERNAL_ERROR' });
}
