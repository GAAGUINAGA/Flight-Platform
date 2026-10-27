import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { verifyBearer, type AuthContext } from '../auth';
import type { GatewayConfig } from '../config';
import { GatewayProblemError } from '../web-errors';
import type { DevAuthService } from './dev-auth';

export const ANY_SCOPE = 'gateway:any-scope';
export const V2_IDEMPOTENT = 'gateway:v2-idempotent';
/** El token debe traer al menos uno de estos scopes (p. ej. `flights:ops` o `flights:admin`). */
export const AnyScope = (...scopes: string[]): MethodDecorator => SetMetadata(ANY_SCOPE, scopes);
export const V2Idempotent = (): MethodDecorator => SetMetadata(V2_IDEMPOTENT, true);

export { isV2Path } from './problem';

/** `X-User-Id` nunca contiene `~` (separador del dueño compuesto) y cabe, junto al clientId, en el límite de 128 del dueño. */
export const USER_ID_PATTERN = /^[A-Za-z0-9._:@+-]{1,64}$/;
export const COMPOSITE_SEPARATOR = '~';
/** Dueño de los recursos de un partner (D1): `<clientId>~<X-User-Id>`; sin usuario final, el propio `clientId`. */
export const partnerOwner = (clientId: string, userId?: string): string => userId ? `${clientId}${COMPOSITE_SEPARATOR}${userId}` : clientId;
/** Cliente al que pertenece un dueño compuesto (la parte previa al primer `~`). */
export const ownerClient = (ownerId: string): string => ownerId.split(COMPOSITE_SEPARATOR, 1)[0];

const bearer = (header: string | undefined): string => header?.startsWith('Bearer ') ? header.slice(7) : '';

/**
 * Autenticación de /api/v2: primero el dev-auth propio (verificación en proceso) y luego los emisores configurados.
 * Con token de partner el dueño es `<clientId>~<X-User-Id>`; con cualquier otro token `X-User-Id` se ignora.
 */
export async function authenticateV2(request: Request, config: GatewayConfig, devAuth?: DevAuthService): Promise<AuthContext> {
  const header = request.header('authorization');
  const principal = devAuth ? await devAuth.verify(bearer(header)) : null;
  let context: AuthContext;
  let clientId: string | undefined;
  if (principal) { context = { ownerId: principal.clientId, role: 'partner', scopes: principal.scopes }; clientId = principal.clientId; }
  else {
    context = await verifyBearer(header, config.jwtIssuers);
    if (context.role === 'partner') clientId = context.ownerId;
  }
  if (clientId) {
    const userId = request.header('x-user-id');
    if (userId !== undefined && !USER_ID_PATTERN.test(userId)) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'X-User-Id inválido');
    context = { ...context, ownerId: partnerOwner(clientId, userId), clientId };
  }
  return context;
}

@Injectable()
export class AnyScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const scopes = this.reflector.getAllAndOverride<string[]>(ANY_SCOPE, [context.getHandler(), context.getClass()]);
    if (!scopes?.length) return true;
    const granted = context.switchToHttp().getRequest<Request>().auth?.scopes ?? new Set<string>();
    if (!scopes.some((scope) => granted.has(scope))) throw new GatewayProblemError(403, 'FORBIDDEN', 'Scope insuficiente');
    return true;
  }
}

/** Huella estable del cuerpo para la idempotencia v2 (el orden de las claves no cambia la huella). */
export const canonicalHash = (body: unknown): string => {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => [k, sort(v)])) : value;
  return createHash('sha256').update(JSON.stringify(sort(body ?? null))).digest('hex');
};
