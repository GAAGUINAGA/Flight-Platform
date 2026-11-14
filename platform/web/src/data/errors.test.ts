import { describe, expect, it } from 'vitest';
import { actionFor, AppError, CATEGORIES, isTransient, knownCodes, messageFor, toAppError, type ErrorCategory } from './errors';

/** Códigos de ProblemDetails v2 (diseño F12c-0 §6.3) tal como los entrega el servicio GraphQL (`UNAUTHORIZED` llega como `UNAUTHENTICATED`). */
const CONTRACT_CODES = ['VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMIT_EXCEEDED', 'IDEMPOTENCY_KEY_REUSED', 'INTERNAL_ERROR', 'PROVIDER_UNAVAILABLE', 'OFFER_NO_LONGER_AVAILABLE', 'HOLD_EXPIRED', 'HOLD_ALREADY_CONSUMED', 'SEAT_TAKEN', 'SEAT_CABIN_MISMATCH', 'INFANT_SEAT_NOT_ALLOWED', 'INFANT_WITHOUT_ADULT', 'PASSENGER_COUNT_MISMATCH', 'DOCUMENT_EXPIRED', 'PASSPORT_REQUIRED_INTERNATIONAL', 'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED', 'AMOUNT_MISMATCH', 'PNR_CREATION_FAILED', 'BOOKING_NOT_CONFIRMED', 'TICKET_ISSUANCE_FAILED', 'TICKET_ALREADY_ISSUED', 'BAGGAGE_LIMIT_EXCEEDED', 'FARE_NOT_CHANGEABLE', 'CHANGE_OFFER_EXPIRED', 'QUOTE_EXPIRED', 'ALREADY_CANCELLED', 'BOOKING_NOT_CANCELLABLE', 'CUTOFF_PASSED', 'CHECK_IN_NOT_AVAILABLE', 'CHECK_IN_FAILED', 'BOARDING_PASS_NOT_AVAILABLE', 'FLIGHT_ALREADY_DEPARTED', 'FLIGHT_CANCELLED', 'FLIGHT_STATUS_NOT_AVAILABLE', 'INVALID_STATUS_TRANSITION', 'PROMOTION_DISCOUNT_OUT_OF_RANGE'];
const SERVICE_CODES = ['GATEWAY_UNAVAILABLE', 'UNKNOWN_GATEWAY_ERROR', 'GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_OPERATION_NOT_ALLOWED', 'GRAPHQL_QUERY_TOO_COMPLEX', 'GRAPHQL_PARSE_FAILED', 'GRAPHQL_BAD_REQUEST', 'GRAPHQL_TIMEOUT', 'PAYLOAD_TOO_LARGE'];

describe('errores por category y code · catálogo en español', () => {
  it('ERR-01 el catálogo cubre cada código del contrato v2 y los propios del servicio, con mensajes en español sin datos del usuario', () => {
    const known = knownCodes();
    for (const code of [...CONTRACT_CODES, ...SERVICE_CODES, 'NETWORK_ERROR', 'CLIENT_TIMEOUT', 'BAD_RESPONSE']) {
      expect(known).toContain(code);
      const message = messageFor(code, 'INTERNAL');
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/[.]$/);
      expect(message).not.toMatch(/\b(failed|not found|unauthorized|undefined|null|the)\b/i);
      expect(message).not.toMatch(/[<>{}]|https?:/);
    }
  });

  it('ERR-02 un código desconocido usa el mensaje de su categoría (todas tienen uno)', () => {
    for (const category of CATEGORIES) expect(messageFor('CODIGO_QUE_NO_EXISTE', category).length).toBeGreaterThan(10);
    expect(messageFor('CODIGO_QUE_NO_EXISTE', 'UNAVAILABLE')).toBe('El servicio no está disponible por ahora. Inténtalo en unos segundos.');
    expect(messageFor('FLIGHT_STATUS_NOT_AVAILABLE', 'NOT_FOUND')).toContain('hora del aeropuerto de origen');
  });

  it('ERR-03 la acción se decide por categoría y código, no por el texto', () => {
    const action = (category: ErrorCategory, code: string) => actionFor({ category, code });
    expect(action('UNAVAILABLE', 'PROVIDER_UNAVAILABLE')).toBe('retry');
    expect(action('UNAVAILABLE', 'CLIENT_TIMEOUT')).toBe('retry');
    expect(action('INTERNAL', 'INTERNAL_ERROR')).toBe('retry');
    expect(action('RATE_LIMITED', 'RATE_LIMIT_EXCEEDED')).toBe('wait');
    expect(action('UNAUTHENTICATED', 'UNAUTHENTICATED')).toBe('login');
    expect(action('FORBIDDEN', 'FORBIDDEN')).toBe('go-home');
    expect(action('VALIDATION', 'VALIDATION_FAILED')).toBe('fix-input');
    expect(action('UNPROCESSABLE', 'PASSENGER_COUNT_MISMATCH')).toBe('fix-input');
    expect(action('CONFLICT', 'OFFER_NO_LONGER_AVAILABLE')).toBe('search-again');
    expect(action('GONE', 'HOLD_EXPIRED')).toBe('search-again');
    expect(action('NOT_FOUND', 'FLIGHT_STATUS_NOT_AVAILABLE')).toBe('none');
    expect(action('FORBIDDEN', 'GRAPHQL_OPERATION_NOT_ALLOWED')).toBe('reload');
  });

  it('ERR-04 solo la indisponibilidad es transitoria; cualquier excepción ajena se convierte en un error genérico sin detalles', () => {
    expect(isTransient(new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE' }))).toBe(true);
    for (const category of CATEGORIES.filter((entry) => entry !== 'UNAVAILABLE')) expect(isTransient(new AppError({ category, code: 'X' }))).toBe(false);
    expect(isTransient(new TypeError('x'))).toBe(false);
    const generic = toAppError(new TypeError("Cannot read properties of undefined (reading 'secret')"));
    expect(generic).toMatchObject({ category: 'INTERNAL', code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado. Inténtalo de nuevo.' });
  });
});
