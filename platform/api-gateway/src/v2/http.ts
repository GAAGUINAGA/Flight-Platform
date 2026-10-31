import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import expressFactory from 'express';
import type { Application, NextFunction, Request, Response } from 'express';
import { middleware as openApiMiddleware } from 'express-openapi-validator';
import { Logger } from '@nestjs/common';
import type { GatewayConfig } from '../config';
import { openApiV2SpecPath } from '../openapi-path';
import { buildV2Problem, v2ProblemFromError } from './problem';
import { authenticateV2 } from './v2-security';
import type { DevAuthService } from './dev-auth';
import { GatewayProblemError } from '../web-errors';

interface V2Spec { servers?: unknown; security?: Array<Record<string, string[]>>; paths: Record<string, Record<string, { security?: Array<Record<string, string[]>> }>>; components: { schemas: { ProblemDetails: object } } }

/** Carga el contrato v2 tal cual y solo fija en memoria el prefijo de montaje; el archivo no se modifica. */
export const loadV2Spec = (): V2Spec => ({ ...(parse(readFileSync(openApiV2SpecPath(), 'utf8')) as V2Spec), servers: [{ url: '/api/v2' }] });

const logger = new Logger('V2Contract');
const MAX_ID_LENGTH = 100;
const requestInfo = (req: Request, res: Response) => ({ method: req.method, path: req.path, correlationId: String(res.getHeader('X-Correlation-Id') ?? '') || undefined });

/** Cabeceras de trazabilidad, parser del token endpoint, validación OpenAPI v2 y manejador de errores RFC 7807 de v2. */
export function mountV2Http(app: Application, config: GatewayConfig, devAuth?: DevAuthService): void {
  app.use('/api/v2', (req: Request, res: Response, next: NextFunction) => {
    const correlation = req.header('x-correlation-id');
    if (correlation && correlation.length > MAX_ID_LENGTH) res.setHeader('X-Correlation-Id', randomUUID());
    const requestId = req.header('x-request-id');
    res.setHeader('X-Request-Id', requestId && requestId.length <= MAX_ID_LENGTH ? requestId : randomUUID());
    next();
  });
  app.use('/api/v2/oauth2/token', expressFactory.urlencoded({ extended: false, limit: '10kb' }));
  const spec = loadV2Spec();
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  const problemSchema = config.validateResponses ? ajv.compile(spec.components.schemas.ProblemDetails) : undefined;
  const protectedRoutes = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods)
    .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
    .filter(([, operation]) => (operation.security ?? spec.security ?? []).length > 0)
    .map(([method, operation]) => ({ method: method.toUpperCase(), pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`), scopes: (operation.security ?? spec.security ?? []).flatMap((entry) => entry.PartnerOAuth2 ?? []) })));
  app.use('/api/v2', async (req: Request, res: Response, next: NextFunction) => {
    const route = protectedRoutes.find((entry) => entry.method === req.method && entry.pattern.test(req.path));
    if (!route) return next();
    try {
      req.auth = await authenticateV2(req, config, devAuth, false);
      const allowed = route.scopes.includes('flights:ops') && req.auth.scopes.has('flights:admin') || route.scopes.every((scope) => req.auth!.scopes.has(scope));
      if (!allowed || req.path.startsWith('/vuelos/webhooks') && !['partner', 'admin'].includes(req.auth.role)) {
        return res.status(403).type('application/problem+json').json(buildV2Problem('FORBIDDEN', requestInfo(req, res)));
      }
      req.auth = await authenticateV2(req, config, devAuth);
      next();
    } catch (error) {
      const problem = error instanceof GatewayProblemError ? v2ProblemFromError(error, requestInfo(req, res)) : buildV2Problem('UNAUTHORIZED', requestInfo(req, res));
      res.status(problem.status).type('application/problem+json').json(problem);
    }
  });
  app.use('/api/v2', (req: Request, res: Response, next: NextFunction) => {
    const correlation = req.header('x-correlation-id');
    if (correlation && correlation.length > MAX_ID_LENGTH) {
      return res.status(400).type('application/problem+json').json(buildV2Problem('VALIDATION_FAILED', requestInfo(req, res), { detail: 'X-Correlation-Id excede 100 caracteres' }));
    }
    next();
  });
  // El contrato lista el descuento fuera de 0–100 como 422 PROMOTION_DISCOUNT_OUT_OF_RANGE; el validador de esquema lo rechazaría con 400.
  // Se aparta el valor para que el esquema no lo rechace y el 422 lo emite el controlador, después de autenticar y autorizar (sin token ⇒ 401, sin scope ⇒ 403).
  app.put('/api/v2/vuelos/promociones/contrato', (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as { porcentaje_descuento_maximo?: unknown } | undefined;
    const percent = body?.porcentaje_descuento_maximo;
    if (body && typeof percent === 'number' && (percent < 0 || percent > 100)) { res.locals.outOfRangeDiscount = percent; body.porcentaje_descuento_maximo = 0; }
    next();
  });
  app.use('/api/v2', openApiMiddleware({
    apiSpec: spec as never, validateRequests: true, validateSecurity: false, validateFormats: true, ajvFormats: { mode: 'full' },
    validateResponses: config.validateResponses ? {
      onError: (error: Error, body: unknown) => {
        // Los errores transversales (401/403/429/5xx) no se repiten en cada operación del contrato: se aceptan si cumplen ProblemDetails.
        if (/no schema defined for status code/.test(error.message) && problemSchema?.(body)) return;
        // La validación de respuestas solo se activa en desarrollo y pruebas; el mensaje describe rutas del esquema, no valores.
        logger.error(`v2 response does not match the contract: ${error.message.slice(0, 600)}`);
        throw error;
      }
    } : false,
    ignorePaths: /\/oauth2\/token|\.well-known|\/booking-events$|\/__test(\/|$)/
  }));
  app.use('/api/v2', (error: unknown, req: Request, res: Response, next: NextFunction) => {
    void next;
    const problem = v2ProblemFromError(error, requestInfo(req, res));
    const validator = typeof error === 'object' && error !== null && 'errors' in error ? (error as { errors?: Array<{ path?: string; message?: string }> }).errors : undefined;
    if (Array.isArray(validator) && problem.status === 400) problem.invalidParams = validator.map((entry) => ({ name: entry.path ?? 'request', reason: entry.message ?? 'invalid' }));
    if (problem.status === 503 && !res.getHeader('Retry-After')) res.setHeader('Retry-After', '5');
    res.status(problem.status).type('application/problem+json').json(problem);
  });
}
