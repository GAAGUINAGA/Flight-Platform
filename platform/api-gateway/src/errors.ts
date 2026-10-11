import { status } from '@grpc/grpc-js';

export interface ProblemDetails { type: string; title: string; status: number; code: string; detail?: string; invalidParams?: Array<{ name: string; reason: string }>; }
const conflict = new Set(['SEAT_TAKEN', 'BOOKING_NOT_CONFIRMED', 'BAGGAGE_LIMIT_EXCEEDED', 'CUTOFF_PASSED', 'FARE_NOT_CHANGEABLE', 'FLIGHT_ALREADY_DEPARTED', 'ALREADY_CANCELLED', 'TICKET_ALREADY_ISSUED', 'CHECK_IN_NOT_AVAILABLE']);
const unprocessable = new Set(['AMOUNT_MISMATCH', 'INFANT_SEAT_NOT_ALLOWED', 'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED', 'CHECK_IN_FAILED', 'SEAT_CABIN_MISMATCH']);

export const PUBLIC_PROBLEM_CODES = new Set([
  'VALIDATION_FAILED', 'SEAT_TAKEN', 'AMOUNT_MISMATCH', 'BOOKING_NOT_CONFIRMED', 'BAGGAGE_LIMIT_EXCEEDED', 'CUTOFF_PASSED', 'FARE_NOT_CHANGEABLE', 'FLIGHT_ALREADY_DEPARTED', 'CHANGE_OFFER_EXPIRED', 'OFFER_NO_LONGER_AVAILABLE', 'QUOTE_EXPIRED', 'ALREADY_CANCELLED', 'RATE_LIMIT_EXCEEDED', 'INFANT_SEAT_NOT_ALLOWED', 'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED', 'PNR_CREATION_FAILED', 'TICKET_ISSUANCE_FAILED', 'TICKET_ALREADY_ISSUED', 'CHECK_IN_NOT_AVAILABLE', 'CHECK_IN_FAILED', 'BOARDING_PASS_NOT_AVAILABLE', 'SEAT_CABIN_MISMATCH', 'FLIGHT_STATUS_NOT_AVAILABLE'
]);

export function problemFor(input: string, operation = ''): ProblemDetails {
  const known = PUBLIC_PROBLEM_CODES.has(input); const code = known ? input : 'VALIDATION_FAILED';
  if (!known) return { type: 'https://flight-platform.dev/problems/validation_failed', title: 'Internal Server Error', status: 500, code, detail: 'An unexpected error occurred' };
  let http = 500;
  if (code === 'VALIDATION_FAILED') http = 400;
  else if (code === 'BOARDING_PASS_NOT_AVAILABLE' || code === 'FLIGHT_STATUS_NOT_AVAILABLE') http = 404;
  else if (code === 'RATE_LIMIT_EXCEEDED') http = 429;
  else if (code === 'OFFER_NO_LONGER_AVAILABLE') http = operation === 'booking' ? 410 : 409;
  else if (code === 'CHANGE_OFFER_EXPIRED') http = 410;
  else if (code === 'QUOTE_EXPIRED') http = 409;
  else if (conflict.has(code)) http = 409;
  else if (unprocessable.has(code)) http = 422;
  return { type: `https://flight-platform.dev/problems/${code.toLowerCase()}`, title: http >= 500 ? 'Internal Server Error' : code, status: http, code };
}

export function problemFromGrpc(code: number, details?: string, operation?: string): ProblemDetails {
  if (code === status.UNAVAILABLE || code === status.DEADLINE_EXCEEDED) return { ...problemFor('RATE_LIMIT_EXCEEDED'), title: 'Service Unavailable', status: 503, detail: 'Service temporarily unavailable' };
  if (code === status.UNAUTHENTICATED) return { ...problemFor('VALIDATION_FAILED'), status: 401 };
  if (code === status.PERMISSION_DENIED) return { ...problemFor('VALIDATION_FAILED'), status: 403 };
  if (code === status.NOT_FOUND) return { ...problemFor('VALIDATION_FAILED'), status: 404, detail: 'Resource not found' };
  return problemFor(details ?? 'VALIDATION_FAILED', operation);
}
