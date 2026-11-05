/** Códigos gRPC que el ESB distingue (valores numéricos del estándar; el dominio no importa grpc-js). */
export const GRPC = { INVALID_ARGUMENT: 3, DEADLINE_EXCEEDED: 4, NOT_FOUND: 5, PERMISSION_DENIED: 7, UNIMPLEMENTED: 12, INTERNAL: 13, UNAVAILABLE: 14, UNAUTHENTICATED: 16 } as const;

const NAMES: Record<number, string> = {
  0: 'OK', 1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT', 4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND', 6: 'ALREADY_EXISTS', 7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED', 9: 'FAILED_PRECONDITION', 10: 'ABORTED', 11: 'OUT_OF_RANGE', 12: 'UNIMPLEMENTED', 13: 'INTERNAL', 14: 'UNAVAILABLE', 15: 'DATA_LOSS', 16: 'UNAUTHENTICATED'
};
export const grpcStatusName = (code: number): string => NAMES[code] ?? 'UNKNOWN';

/** Error de una operación tal como viaja al Gateway (ADR-F12b-02). Nunca lleva mensajes ni trazas internas. */
export interface OperationError {
  source: 'service' | 'esb';
  grpcCode: number;
  grpcStatus: string;
  catalogCode: string | null;
  step?: string;
}

const CATALOG_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export function operationError(source: OperationError['source'], grpcCode: number, catalogCode?: unknown, step?: string): OperationError {
  return {
    source, grpcCode, grpcStatus: grpcStatusName(grpcCode),
    catalogCode: typeof catalogCode === 'string' && CATALOG_CODE.test(catalogCode) ? catalogCode : null,
    ...(step ? { step } : {})
  };
}

/** Traduce lo que lanza un cliente gRPC (`{code, details}`) a un error del sobre. Lo desconocido es INTERNAL del ESB. */
export function errorFromThrown(thrown: unknown, step?: string): OperationError {
  if (typeof thrown === 'object' && thrown !== null && 'code' in thrown && typeof thrown.code === 'number' && thrown.code > 0) {
    return operationError('service', thrown.code, (thrown as { details?: unknown }).details, step);
  }
  return operationError('esb', GRPC.INTERNAL, undefined, step);
}

/** Estado HTTP del sobre de error (ADR-F12b-02). El Gateway decide por `grpcCode`, no por este estado. */
export function httpStatusFor(error: OperationError): number {
  const code = error.grpcCode;
  if (code === GRPC.DEADLINE_EXCEEDED) return 504;
  if (code === GRPC.UNAVAILABLE) return 503;
  if (error.source === 'esb') {
    if (code === GRPC.UNAUTHENTICATED) return 401;
    if (code === GRPC.UNIMPLEMENTED) return 404;
    if (code === GRPC.INVALID_ARGUMENT) return 400;
    return 500;
  }
  if (code === GRPC.NOT_FOUND) return 404;
  if (code === GRPC.PERMISSION_DENIED) return 403;
  if (code === GRPC.UNAUTHENTICATED) return 401;
  return 422;
}
