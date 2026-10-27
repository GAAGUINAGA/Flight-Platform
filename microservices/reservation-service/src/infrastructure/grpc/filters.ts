import { Catch, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, RpcExceptionFilter } from '@nestjs/common';
import { ERROR_CODES, GRPC_STATUS_BY_CODE, requestContextFromMetadata, safeGrpcError, type ErrorCode } from '@flight-platform/shared';
import { Logger as PinoLogger } from 'pino';
import { Observable, tap, throwError } from 'rxjs';
import { prismaDiagnostic } from './prisma-diagnostic';
import { status } from '@grpc/grpc-js';

@Catch()
export class ReservationExceptionFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger('ReservationService');
  catch(error: unknown): Observable<never> {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === status.UNAVAILABLE || code === status.DEADLINE_EXCEEDED) return throwError(() => ({ code, details: 'Service temporarily unavailable' }));
    // Un error de negocio de una dependencia (p. ej. SEAT_TAKEN de Ancillaries) llega como error gRPC de cliente con el código del catálogo en `details`:
    // se devuelve tal cual en lugar de convertirlo en INTERNAL_ERROR (un 500 por un caso previsible).
    const details = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
    if (typeof code === 'number' && typeof details === 'string' && (ERROR_CODES as readonly string[]).includes(details) && GRPC_STATUS_BY_CODE[details as ErrorCode] === code) return throwError(() => ({ code, details }));
    const safe = safeGrpcError(error); if (safe.details === 'INTERNAL_ERROR') this.logger.error(prismaDiagnostic(error)); return throwError(() => safe);
  }
}
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly log: PinoLogger) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = requestContextFromMetadata(context.switchToRpc().getContext()); const rpc = context.getHandler().name; const started = Date.now();
    return next.handle().pipe(tap({ next: () => this.log.info({ rpc, correlationId: request?.correlationId, ms: Date.now() - started }, 'rpc ok'), error: (error: unknown) => this.log.warn({ rpc, correlationId: request?.correlationId, ms: Date.now() - started, error: safeGrpcError(error).details }, 'rpc error') }));
  }
}
