import { CallHandler, Catch, ExecutionContext, Injectable, NestInterceptor, RpcExceptionFilter } from '@nestjs/common';
import { requestContextFromMetadata, safeGrpcError } from '@flight-platform/shared';
import { Logger as PinoLogger } from 'pino';
import { Observable, tap, throwError } from 'rxjs';

@Catch()
export class WebhooksExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(error: unknown): Observable<never> { return throwError(() => safeGrpcError(error)); }
}

@Injectable()
export class WebhooksLoggingInterceptor implements NestInterceptor {
  constructor(private readonly log: PinoLogger) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = context.switchToRpc().getContext(); const request = context.switchToRpc().getData(); const rpc = context.getHandler().name;
    const correlationId = requestContextFromMetadata(metadata)?.correlationId; const started = Date.now();
    this.log.debug({ rpc, correlationId, request }, 'rpc request');
    return next.handle().pipe(tap({ next: () => this.log.info({ rpc, correlationId, ms: Date.now() - started }, 'rpc ok'), error: () => this.log.warn({ rpc, correlationId, ms: Date.now() - started }, 'rpc error') }));
  }
}
