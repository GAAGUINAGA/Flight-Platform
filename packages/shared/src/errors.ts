import { RpcException } from '@nestjs/microservices';
import { Catch, RpcExceptionFilter } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { Observable, throwError } from 'rxjs';

export const ERROR_CODES = [
  'VALIDATION_FAILED', 'SEAT_TAKEN', 'AMOUNT_MISMATCH', 'BOOKING_NOT_CONFIRMED',
  'BAGGAGE_LIMIT_EXCEEDED', 'CUTOFF_PASSED', 'FARE_NOT_CHANGEABLE',
  'FLIGHT_ALREADY_DEPARTED', 'CHANGE_OFFER_EXPIRED', 'OFFER_NO_LONGER_AVAILABLE',
  'QUOTE_EXPIRED', 'ALREADY_CANCELLED', 'RATE_LIMIT_EXCEEDED', 'INFANT_SEAT_NOT_ALLOWED',
  'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED', 'PNR_CREATION_FAILED',
  'TICKET_ISSUANCE_FAILED', 'TICKET_ALREADY_ISSUED', 'CHECK_IN_NOT_AVAILABLE',
  'CHECK_IN_FAILED', 'BOARDING_PASS_NOT_AVAILABLE', 'SEAT_CABIN_MISMATCH',
  'FLIGHT_STATUS_NOT_AVAILABLE',
  // Interno: no figura en el OpenAPI; el Gateway lo traduce a HTTP (F4).
  'NOT_FOUND'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const GRPC_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: status.INVALID_ARGUMENT,
  SEAT_TAKEN: status.ABORTED,
  AMOUNT_MISMATCH: status.FAILED_PRECONDITION,
  BOOKING_NOT_CONFIRMED: status.FAILED_PRECONDITION,
  BAGGAGE_LIMIT_EXCEEDED: status.FAILED_PRECONDITION,
  CUTOFF_PASSED: status.FAILED_PRECONDITION,
  FARE_NOT_CHANGEABLE: status.FAILED_PRECONDITION,
  FLIGHT_ALREADY_DEPARTED: status.FAILED_PRECONDITION,
  CHANGE_OFFER_EXPIRED: status.FAILED_PRECONDITION,
  OFFER_NO_LONGER_AVAILABLE: status.FAILED_PRECONDITION,
  QUOTE_EXPIRED: status.FAILED_PRECONDITION,
  ALREADY_CANCELLED: status.FAILED_PRECONDITION,
  RATE_LIMIT_EXCEEDED: status.RESOURCE_EXHAUSTED,
  INFANT_SEAT_NOT_ALLOWED: status.FAILED_PRECONDITION,
  PAYMENT_REFERENCE_INVALID: status.FAILED_PRECONDITION,
  PAYMENT_NOT_AUTHORIZED: status.FAILED_PRECONDITION,
  PNR_CREATION_FAILED: status.INTERNAL,
  TICKET_ISSUANCE_FAILED: status.INTERNAL,
  TICKET_ALREADY_ISSUED: status.FAILED_PRECONDITION,
  CHECK_IN_NOT_AVAILABLE: status.FAILED_PRECONDITION,
  CHECK_IN_FAILED: status.FAILED_PRECONDITION,
  BOARDING_PASS_NOT_AVAILABLE: status.NOT_FOUND,
  SEAT_CABIN_MISMATCH: status.FAILED_PRECONDITION,
  FLIGHT_STATUS_NOT_AVAILABLE: status.NOT_FOUND,
  NOT_FOUND: status.NOT_FOUND
};

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = 'DomainError';
  }
}

export interface SafeGrpcError { code: number; details: string }

export function safeGrpcError(error: unknown): SafeGrpcError {
  if (error instanceof DomainError) {
    return { code: GRPC_STATUS_BY_CODE[error.code], details: error.code };
  }
  let payload: unknown;
  try {
    payload = typeof error === 'object' && error !== null && 'getError' in error &&
      typeof error.getError === 'function' ? error.getError() : undefined;
  } catch {
    return { code: status.INTERNAL, details: 'INTERNAL_ERROR' };
  }
  if (typeof payload === 'object' && payload !== null && 'code' in payload && 'details' in payload) {
    const { code, details } = payload;
    if (typeof code === 'number' && typeof details === 'string') {
      if (ERROR_CODES.includes(details as ErrorCode) && GRPC_STATUS_BY_CODE[details as ErrorCode] === code) {
        return { code, details };
      }
      if (details === 'UNAUTHENTICATED' && code === status.UNAUTHENTICATED) return { code, details };
      if (details === 'PERMISSION_DENIED' && code === status.PERMISSION_DENIED) return { code, details };
    }
  }
  return { code: status.INTERNAL, details: 'INTERNAL_ERROR' };
}

export function toRpcException(error: unknown): RpcException {
  return new RpcException(safeGrpcError(error));
}

@Catch()
export class DomainRpcExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(error: unknown): Observable<never> {
    return throwError(() => toRpcException(error));
  }
}
