import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { verifyBearer, type AuthContext } from './auth';
import type { GatewayConfig } from './config';
import { GatewayProblemError } from './web-errors';
import type { DevAuthService } from './v2/dev-auth';
import { authenticateV2, isV2Path } from './v2/v2-security';

export const PUBLIC = 'gateway:public';
export const ROLES = 'gateway:roles';
export const SCOPES = 'gateway:scopes';
export const IDEMPOTENT = 'gateway:idempotent';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC, true);
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES, roles);
export const Scopes = (...scopes: string[]): MethodDecorator & ClassDecorator => SetMetadata(SCOPES, scopes);
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT, true);

declare module 'express-serve-static-core' { interface Request { auth?: AuthContext; } }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly config: GatewayConfig, private readonly devAuth?: DevAuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (isV2Path(request.path)) {
      try { request.auth = await authenticateV2(request, this.config, this.devAuth); return true; }
      catch (error) {
        if (error instanceof GatewayProblemError) throw error;
        throw new GatewayProblemError(401, 'UNAUTHORIZED', 'Se requiere autenticación');
      }
    }
    try { request.auth = await verifyBearer(request.header('authorization'), this.config.jwtIssuers); return true; }
    catch { throw new GatewayProblemError(401, 'VALIDATION_FAILED', 'Authentication required'); }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    if (!roles.includes(context.switchToHttp().getRequest<Request>().auth?.role ?? '')) throw new GatewayProblemError(403, 'VALIDATION_FAILED', 'Access denied');
    return true;
  }
}

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const scopes = this.reflector.getAllAndOverride<string[]>(SCOPES, [context.getHandler(), context.getClass()]);
    if (!scopes?.length) return true;
    const granted = context.switchToHttp().getRequest<Request>().auth?.scopes ?? new Set<string>();
    if (!scopes.every((scope) => granted.has(scope))) throw new GatewayProblemError(403, 'VALIDATION_FAILED', 'Access denied');
    return true;
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly config: GatewayConfig) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>(); const response = context.switchToHttp().getResponse<Response>();
    const authenticated = Boolean(request.auth); const identity = authenticated ? `sub:${request.auth!.ownerId}` : `fp:${request.header('x-device-fingerprint') ?? request.ip ?? 'unknown'}`;
    const now = Date.now(); let state: { count: number; resetAt: number };
    try {
      const previous = this.windows.get(identity); state = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : previous;
      state.count += 1; this.windows.set(identity, state);
    } catch {
      throw new GatewayProblemError(503, 'RATE_LIMIT_EXCEEDED', 'Service temporarily unavailable');
    }
    if (state.count > (authenticated ? this.config.authLimit : this.config.publicLimit)) {
      response.setHeader('Retry-After', Math.max(1, Math.ceil((state.resetAt - now) / 1000)));
      throw new GatewayProblemError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests');
    }
    return true;
  }
}
