import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { z } from 'zod';

export interface RequestContext { ownerId?: string; role?: string; correlationId: string }
export interface MetadataLike { get(key: string): unknown[] }
const requestContextSymbol = Symbol('flightplatform.requestContext');
type ContextMetadata = MetadataLike & { [requestContextSymbol]?: RequestContext };

const first = (metadata: MetadataLike, key: string): string | undefined => {
  const value = metadata.get(key)[0];
  return typeof value === 'string' ? value : undefined;
};

const equalSecret = (actual: string | undefined, expected: string): boolean => {
  if (!actual) return false;
  const left = createHash('sha256').update(actual).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
};

export function buildRequestContext(metadata: MetadataLike, internalApiKey: string): RequestContext {
  if (!internalApiKey || !equalSecret(first(metadata, 'x-internal-key'), internalApiKey)) {
    throw new RpcException({ code: status.UNAUTHENTICATED, details: 'UNAUTHENTICATED' });
  }
  return {
    ownerId: first(metadata, 'x-owner-id'),
    role: first(metadata, 'x-role'),
    correlationId: first(metadata, 'x-correlation-id') ?? randomUUID()
  };
}

export function requestContextFromMetadata(metadata: MetadataLike): RequestContext | undefined {
  return (metadata as ContextMetadata)[requestContextSymbol];
}

@Injectable()
export class InternalKeyInterceptor implements NestInterceptor {
  constructor(private readonly internalApiKey: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = context.switchToRpc().getContext<ContextMetadata>();
    metadata[requestContextSymbol] = buildRequestContext(metadata, this.internalApiKey);
    return next.handle();
  }
}

export function requireRole(context: RequestContext, ...roles: Array<'admin' | 'system'>): void {
  if (!context.role || !roles.includes(context.role as 'admin' | 'system')) {
    throw new RpcException({ code: status.PERMISSION_DENIED, details: 'PERMISSION_DENIED' });
  }
}

export function validate<T extends z.AnyZodObject>(schema: T, input: unknown): z.output<T> {
  const result = schema.strict().safeParse(input);
  if (!result.success) throw new RpcException({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' });
  return result.data;
}

export function rpcString(maxLength = 255) {
  return z.string().trim().min(1).max(maxLength);
}
