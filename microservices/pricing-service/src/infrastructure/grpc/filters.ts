import { Catch, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, RpcExceptionFilter } from '@nestjs/common';
import { requestContextFromMetadata, safeGrpcError } from '@flight-platform/shared';
import { Observable, throwError, tap } from 'rxjs';
import { Logger as PinoLogger } from 'pino';

@Catch()
export class PricingExceptionFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger('PricingService');
  catch(error: unknown): Observable<never> {
    const safe = safeGrpcError(error);
    if (safe.details === 'INTERNAL_ERROR') this.logger.error(`internal error: ${error instanceof Error ? error.name : typeof error}`);
    return throwError(() => safe);
  }
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly log: PinoLogger) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = context.switchToRpc().getContext() as { get(key: string): unknown[] };
    const requestContext = requestContextFromMetadata(metadata);
    const rpc = context.getHandler().name;
    const started = Date.now();
    const sensitive = { ownerId: requestContext?.ownerId, internalApiKey: metadata.get('x-internal-key')[0] };
    return next.handle().pipe(tap({
      next: () => this.log.info({ rpc, correlationId: requestContext?.correlationId, ms: Date.now() - started, sensitive }, 'rpc ok'),
      error: (error: unknown) => this.log.warn({ rpc, correlationId: requestContext?.correlationId, ms: Date.now() - started, error: safeGrpcError(error).details, sensitive }, 'rpc error')
    }));
  }
}
