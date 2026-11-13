/**
 * Errores públicos del servicio GraphQL (diseño F12c-0 §6.3). Sin dependencias de infraestructura.
 * El servicio NUNCA reenvía el cuerpo del Gateway: construye un error con `category`, `code` y un mensaje de un catálogo propio (español, sin valores del usuario).
 */
export type ErrorCategory = 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'GONE' | 'UNPROCESSABLE' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INTERNAL';

export interface InvalidParam { name: string; reason?: string }
export interface PublicErrorInit { code: string; category: ErrorCategory; httpStatus: number; retryAfterSeconds?: number | null; invalidParams?: InvalidParam[] }

export class PublicError extends Error {
  readonly code: string; readonly category: ErrorCategory; readonly httpStatus: number; readonly retryAfterSeconds: number | null; readonly invalidParams: InvalidParam[];
  constructor(init: PublicErrorInit, message = messageFor(init.code, init.category)) {
    super(message); this.name = 'PublicError'; this.code = init.code; this.category = init.category; this.httpStatus = init.httpStatus;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null; this.invalidParams = init.invalidParams ?? [];
  }
}

/** Mensajes propios por `code` (el `detail` del Gateway no se reenvía). */
const MESSAGES: Record<string, string> = {
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
  FLIGHT_STATUS_NOT_AVAILABLE: 'No hay estado disponible para ese vuelo.',
  INVALID_STATUS_TRANSITION: 'Ese cambio de estado del vuelo no es válido.',
  PROMOTION_DISCOUNT_OUT_OF_RANGE: 'El descuento debe estar entre 0 y 100.',
  UNKNOWN_GATEWAY_ERROR: 'No pudimos completar la operación.',
  GRAPHQL_VALIDATION_FAILED: 'La consulta no es válida.',
  GRAPHQL_OPERATION_NOT_ALLOWED: 'Esa operación no está permitida.',
  GRAPHQL_QUERY_TOO_COMPLEX: 'La consulta es demasiado compleja.',
  GRAPHQL_PARSE_FAILED: 'No pudimos interpretar la consulta.',
  GRAPHQL_BAD_REQUEST: 'La petición no es válida.',
  GRAPHQL_TIMEOUT: 'La operación tardó demasiado. Inténtalo de nuevo.',
  PAYLOAD_TOO_LARGE: 'La petición es demasiado grande.'
};
export function messageFor(code: string, category: ErrorCategory): string {
  return MESSAGES[code] ?? (category === 'INTERNAL' ? MESSAGES.INTERNAL_ERROR : category === 'UNAVAILABLE' ? MESSAGES.PROVIDER_UNAVAILABLE : MESSAGES.UNKNOWN_GATEWAY_ERROR);
}

/** La categoría se decide PRIMERO por el estado HTTP y luego por el código (un guardia heredado puede responder VALIDATION_FAILED con 401/403). */
export function categoryFor(httpStatus: number, code: string | undefined): ErrorCategory {
  if (httpStatus === 400) return 'VALIDATION';
  if (httpStatus === 401) return 'UNAUTHENTICATED';
  if (httpStatus === 403) return 'FORBIDDEN';
  if (httpStatus === 404) return 'NOT_FOUND';
  if (httpStatus === 409) return 'CONFLICT';
  if (httpStatus === 410) return 'GONE';
  if (httpStatus === 422) return 'UNPROCESSABLE';
  if (httpStatus === 429) return 'RATE_LIMITED';
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return 'UNAVAILABLE';
  if (httpStatus >= 500) return 'INTERNAL';
  if (code === 'RATE_LIMIT_EXCEEDED') return 'RATE_LIMITED';
  return 'INTERNAL';
}

const SAFE_NAME = /^[A-Za-z0-9_.[\]-]{1,100}$/;
const SAFE_REASON = /^[\p{L}\p{N} .,:;()'"/_+-]{1,160}$/u;
/** Solo `name` y `reason` con caracteres seguros: el resto del cuerpo del Gateway no sale. */
export function safeInvalidParams(value: unknown): InvalidParam[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { name, reason } = entry as { name?: unknown; reason?: unknown };
    if (typeof name !== 'string' || !SAFE_NAME.test(name)) return [];
    return [{ name, ...(typeof reason === 'string' && SAFE_REASON.test(reason) ? { reason } : {}) }];
  });
}

export interface GatewayFailure { status: number; body?: unknown; retryAfter?: string | null; invalidBody?: boolean }
/** Traduce una respuesta de error del Gateway (ProblemDetails v2) a un error público. */
export function fromGatewayFailure(failure: GatewayFailure): PublicError {
  const problem = typeof failure.body === 'object' && failure.body !== null ? failure.body as { code?: unknown; invalidParams?: unknown } : {};
  const rawCode = typeof problem.code === 'string' ? problem.code : undefined;
  const category = categoryFor(failure.status, rawCode);
  let code = rawCode ?? (category === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : category === 'UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : category === 'INTERNAL' ? 'INTERNAL_ERROR' : category === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN_GATEWAY_ERROR');
  if (code === 'UNAUTHORIZED' || category === 'UNAUTHENTICATED') code = 'UNAUTHENTICATED';
  else if (category === 'FORBIDDEN') code = 'FORBIDDEN';
  else if (!(code in MESSAGES) || failure.invalidBody) code = category === 'INTERNAL' ? 'INTERNAL_ERROR' : category === 'UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : 'UNKNOWN_GATEWAY_ERROR';
  const seconds = failure.retryAfter !== undefined && failure.retryAfter !== null ? Number(failure.retryAfter) : NaN;
  return new PublicError({ code, category, httpStatus: failure.status, retryAfterSeconds: Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null, invalidParams: safeInvalidParams((problem as { invalidParams?: unknown }).invalidParams) });
}

export const validationError = (name: string, reason?: string): PublicError => new PublicError({ code: 'VALIDATION_FAILED', category: 'VALIDATION', httpStatus: 400, invalidParams: [{ name, ...(reason ? { reason } : {}) }] });
export const unauthenticated = (): PublicError => new PublicError({ code: 'UNAUTHENTICATED', category: 'UNAUTHENTICATED', httpStatus: 401 });
export const forbidden = (): PublicError => new PublicError({ code: 'FORBIDDEN', category: 'FORBIDDEN', httpStatus: 403 });
export const gatewayUnavailable = (): PublicError => new PublicError({ code: 'GATEWAY_UNAVAILABLE', category: 'UNAVAILABLE', httpStatus: 503 });
