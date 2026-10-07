import { Catch, CallHandler, ExecutionContext, Injectable, NestInterceptor, RpcExceptionFilter } from '@nestjs/common';
import { GRPC_STATUS_BY_CODE, requestContextFromMetadata, safeGrpcError } from '@flight-platform/shared';
import { Logger as PinoLogger } from 'pino';
import { Observable, tap, throwError } from 'rxjs';
@Catch()
export class TicketingExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(error: unknown): Observable<never> {
    if (error instanceof Error && 'code' in error && typeof (error as { code: unknown }).code === 'string' && (error as { code: string }).code in GRPC_STATUS_BY_CODE) {
      const code = (error as { code: keyof typeof GRPC_STATUS_BY_CODE }).code;
      return throwError(() => ({ code: GRPC_STATUS_BY_CODE[code], details: code }));
    }
    return throwError(() => safeGrpcError(error));
  }
}

/** Registra solo los campos necesarios; Pino redacta PII antes de escribirla. */
@Injectable()
export class TicketingLoggingInterceptor implements NestInterceptor {
  constructor(private readonly log: PinoLogger) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = context.switchToRpc().getContext();
    const ctx = requestContextFromMetadata(metadata);
    const rpc = context.getHandler().name;
    const started = Date.now();
    this.log.debug({ rpc, correlationId: ctx?.correlationId, request: context.switchToRpc().getData() }, 'rpc request');
    return next.handle().pipe(tap({
      next: () => this.log.info({ rpc, correlationId: ctx?.correlationId, ms: Date.now() - started }, 'rpc ok'),
      error: (error: unknown) => this.log.warn({ rpc, correlationId: ctx?.correlationId, ms: Date.now() - started, error: safeGrpcError(error).details }, 'rpc error')
    }));
  }
}
