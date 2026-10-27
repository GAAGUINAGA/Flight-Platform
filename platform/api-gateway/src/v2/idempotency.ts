import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, mergeMap } from 'rxjs';
import type { GatewayIdempotencyPort } from '../idempotency.interceptor';
import { GatewayProblemError } from '../web-errors';
import { V2_IDEMPOTENT, type V2IdempotencyOptions } from './v2-security';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Orden de las claves del cuerpo no relevante: se hashea una forma canónica. */
const canonical = (body: unknown): unknown => JSON.parse(JSON.stringify(body ?? null, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : 1)) : value));

/**
 * Idempotencia de v2 (separada de la de v1, que no cambia): `Idempotency-Key` UUID v4 obligatorio, misma clave con otro
 * cuerpo → 409 IDEMPOTENCY_KEY_REUSED, reintento → 200 con `Idempotent-Replayed: true`. La clave se aísla por operación.
 */
@Injectable()
export class V2IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly store: GatewayIdempotencyPort) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<V2IdempotencyOptions | undefined>(V2_IDEMPOTENT, context.getHandler());
    if (!options) return next.handle();
    const request = context.switchToHttp().getRequest<Request>(); const response = context.switchToHttp().getResponse<Response>();
    const key = request.header('idempotency-key'); const ownerId = request.auth?.ownerId;
    if (!key || !UUID_V4.test(key) || !ownerId) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'Idempotency-Key es obligatorio y debe ser un UUID v4');
    return new Observable((subscriber) => { void (async () => {
      try {
        const record = await this.store.begin(ownerId, `v2:${options.operation}:${key}`, canonical(request.body));
        if (record === 'MISMATCH') throw new GatewayProblemError(409, 'IDEMPOTENCY_KEY_REUSED', 'La Idempotency-Key ya se usó con otra solicitud');
        if (record === 'IN_PROGRESS') { response.setHeader('Retry-After', '1'); throw new GatewayProblemError(409, 'IDEMPOTENCY_KEY_REUSED', 'La solicitud con esta Idempotency-Key sigue en curso'); }
        if (record.responseCode) {
          response.setHeader('Idempotent-Replayed', 'true');
          if (!options.recompute) { response.status(200); subscriber.next(record.responseBody); subscriber.complete(); return; }
          request.v2Replay = true;
          next.handle().subscribe({ next: (body) => subscriber.next(body), complete: () => subscriber.complete(), error: (error: unknown) => subscriber.error(error) });
          return;
        }
        next.handle().pipe(mergeMap(async (body) => { await this.store.complete(record.id, response.statusCode || 200, body as object); return body; })).subscribe({
          next: (body) => subscriber.next(body), complete: () => subscriber.complete(),
          error: (error: unknown) => { void (async () => {
            // Una operación que falló no queda "en curso": con la misma clave y el mismo cuerpo se puede reintentar.
            try { await this.store.retry(record.id); } catch (retryError) { subscriber.error(retryError); return; }
            subscriber.error(error);
          })(); }
        });
      } catch (error) { subscriber.error(error); }
    })(); });
  }
}
