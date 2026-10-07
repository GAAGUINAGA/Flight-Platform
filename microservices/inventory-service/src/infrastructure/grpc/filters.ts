import { Catch, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, RpcExceptionFilter } from '@nestjs/common';
import { GRPC_STATUS_BY_CODE, requestContextFromMetadata, safeGrpcError } from '@flight-platform/shared';
import { Observable, throwError, tap } from 'rxjs';
import { InventoryError } from '../../domain/errors';
import { Logger as PinoLogger } from 'pino';

/**
 * Traduce errores a gRPC sin detalles internos usando el cat?logo compartido (D-07).
 */
@Catch()
export class InventoryExceptionFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger('InventoryService');

  catch(error: unknown): Observable<never> {
    // El servidor gRPC de Nest espera el payload plano { code, details }, no una RpcException.
    if (error instanceof InventoryError) {
      return throwError(() => ({ code: GRPC_STATUS_BY_CODE[error.code], details: error.code }));
    }
    const safe = safeGrpcError(error);
    if (safe.details === 'INTERNAL_ERROR') {
      // Solo el tipo de error: los mensajes de Prisma pueden incluir valores de usuario.
      this.logger.error("internal error: " + (error instanceof Error ? error.name : typeof error));
    }
    return throwError(() => safe);
  }
}

/** Registra la operaci?n (sin cuerpo salvo en debug, y con redacci?n de PII). */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly log: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = context.switchToRpc().getContext();
    const ctx = requestContextFromMetadata(metadata);
    const rpc = context.getHandler().name;
    const started = Date.now();
    this.log.debug({ rpc, correlationId: ctx?.correlationId, request: context.switchToRpc().getData() }, 'rpc request');
    return next.handle().pipe(
      tap({
        next: () => this.log.info({ rpc, correlationId: ctx?.correlationId, ms: Date.now() - started }, 'rpc ok'),
        error: (e: unknown) =>
          this.log.warn({ rpc, correlationId: ctx?.correlationId, ms: Date.now() - started, error: safeGrpcError(e).details }, 'rpc error')
      })
    );
  }
}
