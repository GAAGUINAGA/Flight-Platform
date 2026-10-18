import { Catch, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, RpcExceptionFilter } from '@nestjs/common';
import { requestContextFromMetadata, safeGrpcError } from '@flight-platform/shared';
import { Logger as PinoLogger } from 'pino';
import { Observable, tap, throwError } from 'rxjs';
import { prismaDiagnostic } from './prisma-diagnostic';

@Catch()
export class ReservationExceptionFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger('ReservationService');
  catch(error: unknown): Observable<never> { const safe = safeGrpcError(error); if (safe.details === 'INTERNAL_ERROR') this.logger.error(prismaDiagnostic(error)); return throwError(() => safe); }
}
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly log: PinoLogger) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = requestContextFromMetadata(context.switchToRpc().getContext()); const rpc = context.getHandler().name; const started = Date.now();
    return next.handle().pipe(tap({ next: () => this.log.info({ rpc, correlationId: request?.correlationId, ms: Date.now() - started }, 'rpc ok'), error: (error: unknown) => this.log.warn({ rpc, correlationId: request?.correlationId, ms: Date.now() - started, error: safeGrpcError(error).details }, 'rpc error') }));
  }
}
