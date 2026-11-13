import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import type { Application, NextFunction, Request, Response } from 'express';
import { Body, Controller, Get, Inject, Logger, Put, Query, Req } from '@nestjs/common';
import { middleware as openApiMiddleware } from 'express-openapi-validator';
import { AdminController } from './admin.controller';
import type { GatewayConfig } from './config';
import { openApiAdminSpecPath } from './openapi-path';
import { Roles, Scopes } from './security';
import { GatewayProblemError } from './web-errors';
import { buildV2Problem, v2ProblemFromError } from './v2/problem';
import { authenticateV2 } from './v2/v2-security';
import type { DevAuthService } from './v2/dev-auth';
import { decodeCreatedCursor, encodeCreatedCursor } from './v2/list-cursor';
import type { V2StateStore } from './v2/state';
import { webPassengerCount } from './v2/web-sales';

/**
 * API interna de administración, versión 1 (`/api/admin/v1`, ADR-F12c-02): solo para el panel, solo rol `admin` con `flights:admin`.
 * Su OpenAPI (`contracts/openapi/interno/admin-v1.yaml`) está separado de los contratos con Booking y no tiene relación con el contrato v1 deprecado.
 * Reutiliza los manejadores de `AdminController` (mismos esquemas Zod, mismas llamadas a los servicios); la única operación nueva es `GET /web-bookings`.
 */
export class AdminApiController {
  private readonly admin: AdminController;
  constructor(config: GatewayConfig, private readonly state: V2StateStore) { this.admin = new AdminController(config); }
  listFlights(req: Request, query: { date?: string; limit?: number | string; cursor?: string }) {
    // El validador OpenAPI convierte `limit` en número; los esquemas Zod heredados lo esperan como texto.
    return this.admin.listFlights(req, { ...query, ...(query.limit !== undefined ? { limit: String(query.limit) } : {}) });
  }
  listFares(req: Request, query: unknown) { return this.admin.listFares(req, query); }
  upsertFare(req: Request, body: unknown) { return this.admin.upsertFare(req, body); }
  async webBookings(_req: Request, query: { limit?: number | string; before?: string }) {
    const limit = query.limit === undefined ? 20 : Number(query.limit); const rawBefore: unknown = query.before; const badType = rawBefore !== undefined && typeof rawBefore !== 'string'; // `before[]=` o `before=a&before=b` llegan como arreglo/objeto
    const before = typeof rawBefore === 'string' && rawBefore !== '' ? decodeCreatedCursor(rawBefore) : undefined;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || badType || (rawBefore !== undefined && rawBefore !== '' && !before) || rawBefore === '') throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'Invalid fields: limit, before');
    // Se pide uno más para saber si quedan reservas: sin él, una página exacta emitía un nextCursor que llevaba a una página vacía.
    const fetched = await this.state.listWebBookings({ limit: limit + 1, ...(before ? { before } : {}) });
    const more = fetched.length > limit; const rows = fetched.slice(0, limit);
    const items = rows.map((row) => ({ bookingId: row.bookingId, createdAt: (row.createdAt ?? new Date(0)).toISOString(), channel: 'WEB' as const, test: true as const, passengers: webPassengerCount(row.salesChannel), owner: createHash('sha256').update(row.ownerId).digest('hex').slice(0, 12) }));
    // Cursor compuesto (fecha de creación, bookingId): opaco; dos reservas del mismo milisegundo no se repiten ni se saltan en el borde de una página.
    const last = rows.at(-1);
    return { items, nextCursor: more && last ? encodeCreatedCursor(last.createdAt ?? new Date(0), last.bookingId) : null };
  }
}
const P = AdminApiController.prototype;
Controller('api/admin/v1')(AdminApiController);
Inject('GATEWAY_CONFIG')(AdminApiController, undefined as unknown as string, 0); Inject('V2_STATE')(AdminApiController, undefined as unknown as string, 1);
const d = (method: keyof AdminApiController) => Object.getOwnPropertyDescriptor(P, method)!;
Get('flights')(P, 'listFlights', d('listFlights')); Req()(P, 'listFlights', 0); Query()(P, 'listFlights', 1);
Get('fares')(P, 'listFares', d('listFares')); Req()(P, 'listFares', 0); Query()(P, 'listFares', 1);
Put('fares')(P, 'upsertFare', d('upsertFare')); Req()(P, 'upsertFare', 0); Body()(P, 'upsertFare', 1);
Get('web-bookings')(P, 'webBookings', d('webBookings')); Req()(P, 'webBookings', 0); Query()(P, 'webBookings', 1);
Roles('admin')(AdminApiController); Scopes('flights:admin')(AdminApiController);

const logger = new Logger('AdminApiContract');
const requestInfo = (req: Request, res: Response) => ({ method: req.method, path: req.path, correlationId: String(res.getHeader('X-Correlation-Id') ?? '') || undefined });
interface AdminSpec { servers?: unknown; components: { schemas: { ProblemDetails: object } } }

/** Autentica y autoriza ANTES de validar el contrato (sin token ⇒ 401, otro rol o scope ⇒ 403, aunque el cuerpo sea inválido) y valida contra el OpenAPI interno. */
export function mountAdminApiHttp(app: Application, config: GatewayConfig, devAuth?: DevAuthService): void {
  const spec = { ...(parse(readFileSync(openApiAdminSpecPath(), 'utf8')) as AdminSpec), servers: [{ url: '/api/admin/v1' }] };
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  const problemSchema = config.validateResponses ? ajv.compile(spec.components.schemas.ProblemDetails) : undefined;
  app.use('/api/admin/v1', async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.auth = await authenticateV2(req, config, devAuth, false);
      if (req.auth.role !== 'admin' || !req.auth.scopes.has('flights:admin')) return res.status(403).type('application/problem+json').json(buildV2Problem('FORBIDDEN', requestInfo(req, res)));
      next();
    } catch (error) {
      const problem = error instanceof GatewayProblemError ? v2ProblemFromError(error, requestInfo(req, res)) : buildV2Problem('UNAUTHORIZED', requestInfo(req, res));
      res.status(problem.status).type('application/problem+json').json(problem);
    }
  });
  app.use('/api/admin/v1', openApiMiddleware({
    apiSpec: spec as never, validateRequests: true, validateSecurity: false, validateFormats: true, ajvFormats: { mode: 'full' },
    validateResponses: config.validateResponses ? {
      onError: (error: Error, body: unknown) => {
        if (/no schema defined for status code/.test(error.message) && problemSchema?.(body)) return;
        logger.error(`admin API response does not match the contract: ${error.message.slice(0, 600)}`);
        throw error;
      }
    } : false
  }));
  app.use('/api/admin/v1', (error: unknown, req: Request, res: Response, next: NextFunction) => {
    void next;
    const problem = v2ProblemFromError(error, requestInfo(req, res));
    const validator = typeof error === 'object' && error !== null && 'errors' in error ? (error as { errors?: Array<{ path?: string; message?: string }> }).errors : undefined;
    if (Array.isArray(validator) && problem.status === 400) problem.invalidParams = validator.map((entry) => ({ name: entry.path ?? 'request', reason: entry.message ?? 'invalid' }));
    if (problem.status === 503 && !res.getHeader('Retry-After')) res.setHeader('Retry-After', '5');
    res.status(problem.status).type('application/problem+json').json(problem);
  });
}
