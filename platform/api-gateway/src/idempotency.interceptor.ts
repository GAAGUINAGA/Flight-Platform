import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, mergeMap } from 'rxjs';
import { type GatewayIdempotencyRecord } from './idempotency';
import { IDEMPOTENT } from './security';
import { GatewayProblemError } from './web-errors';

export interface GatewayIdempotencyPort {
  begin(ownerId: string, key: string, body: unknown): Promise<GatewayIdempotencyRecord | 'MISMATCH' | 'IN_PROGRESS'>;
  complete(id: string, status: number, body: object): Promise<void>;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly store: GatewayIdempotencyPort) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, context.getHandler())) return next.handle();
    const request = context.switchToHttp().getRequest<Request>(); const response = context.switchToHttp().getResponse<Response>();
    const key = request.header('idempotency-key'); const ownerId = request.auth?.ownerId;
    if (!key || !ownerId) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'Idempotency-Key is required');
    return new Observable((subscriber) => { void (async () => {
      try {
        const record = await this.store.begin(ownerId, key, request.body);
        if (record === 'MISMATCH') throw new GatewayProblemError(422, 'VALIDATION_FAILED', 'Idempotency key was used with a different request');
        if (record === 'IN_PROGRESS') { response.setHeader('Retry-After', '1'); throw new GatewayProblemError(409, 'VALIDATION_FAILED', 'Request is in progress'); }
        if (record.responseCode) { response.status(record.responseCode); subscriber.next(record.responseBody); subscriber.complete(); return; }
        next.handle().pipe(mergeMap(async (body) => { await this.store.complete(record.id, response.statusCode || 200, body as object); return body; })).subscribe(subscriber);
      } catch (error) { subscriber.error(error); }
    })(); });
  }
}
