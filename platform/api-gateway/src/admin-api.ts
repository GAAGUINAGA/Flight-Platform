import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import expressFactory from 'express';
import type { Application, NextFunction, Request, Response } from 'express';
import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Put, Query, Req } from '@nestjs/common';
import { middleware as openApiMiddleware } from 'express-openapi-validator';
import { adminErrorCode, asPnr, InMemoryAdminAccessLog, type AdminAccessLog, type AdminErrorCode, type AdminResult, type Pnr } from './admin-access-log';
import { publicAdminBooking } from './admin-booking-view';
import { AdminController } from './admin.controller';
import { callGatewayGrpc } from './grpc-clients';
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
  constructor(private readonly config: GatewayConfig, private readonly state: V2StateStore, private readonly accessLog: AdminAccessLog = new InMemoryAdminAccessLog()) { this.admin = new AdminController(config); }
  listFlights(req: Request, query: { date?: string; limit?: number | string; cursor?: string }) {
    // El validador OpenAPI convierte `limit` en número; los esquemas Zod heredados lo esperan como texto.
    return this.admin.listFlights(req, { ...query, ...(query.limit !== undefined ? { limit: String(query.limit) } : {}) });
  }
  listFares(req: Request, query: unknown) { return this.admin.listFares(req, query); }
  upsertFare(req: Request, body: unknown) { return this.admin.upsertFare(req, body); }
  /**
   * Búsqueda de solo lectura por PNR, de cualquier canal (F12c-4a, ADR-F12c4-01). ÚNICO punto de la búsqueda: cualquiera sea el desenlace (cuerpo
   * inválido de cualquier tipo, límite, encontrada, no encontrada, error de un servicio o del propio gateway) escribe exactamente UNA fila del registro
   * ANTES de responder; si esa escritura falla, la respuesta es 503 sin datos. Nadie más escribe el registro de la búsqueda. Un PNR inexistente,
   * ajeno o mal formado produce exactamente la misma respuesta «no encontrada».
   */
  async searchBooking(req: Request, body: unknown) {
    const actorSub = req.auth!.ownerId; const correlationId = String(req.res?.getHeader('X-Correlation-Id') ?? '');
    let outcome: SearchOutcome; let response: unknown; let failure: unknown; let failed = false;
    try { ({ outcome, response } = await this.performSearch(req, body, actorSub, correlationId)); }
    catch (error) {
      failed = true;
      if (error instanceof SearchStop) { outcome = error.outcome; failure = error.respondWith; }
      else { outcome = { result: 'ERROR', subject: null, errorCode: adminErrorCode(error) }; failure = error; }
    }
    try { await this.accessLog.record({ ...outcome, actorSub, action: 'SEARCH_PNR', correlationId }); }
    catch { throw new GatewayProblemError(503, 'PROVIDER_UNAVAILABLE', 'Audit log unavailable'); }
    if (failed) throw failure;
    return response;
  }
  /** Decide el desenlace de la búsqueda; NO escribe el registro (lo hace `searchBooking` una sola vez). Lo que no es éxito se lanza como `SearchStop`. */
  private async performSearch(req: Request, body: unknown, actorSub: string, correlationId: string): Promise<{ outcome: SearchOutcome; response: unknown }> {
    let used: number;
    try { used = await this.accessLog.countSince(actorSub, 'SEARCH_PNR', new Date(Date.now() - 3_600_000)); }
    catch { throw new SearchStop({ result: 'ERROR', subject: null, errorCode: 'PROVIDER_UNAVAILABLE' }, new GatewayProblemError(503, 'PROVIDER_UNAVAILABLE', 'Audit log unavailable')); }
    if (used >= (this.config.admin?.pnrSearchLimitPerHour ?? 30)) {
      req.res?.setHeader('Retry-After', '60');
      throw new SearchStop({ result: 'RATE_LIMITED', subject: null }, new GatewayProblemError(429, 'RATE_LIMIT_EXCEEDED', 'Too many searches; try again later', 'admin-pnr-search-limit'));
    }
    // Un cuerpo o PNR inválido (de cualquier tipo) responde igual que un PNR que no existe, y su texto NO se guarda (podría ser cualquier cosa pegada por error).
    const pnr = pnrFromBody(body);
    if (!pnr) throw new SearchStop({ result: 'INVALID_FORMAT', subject: null }, notFound());
    let view: Record<string, unknown>;
    try { view = await callGatewayGrpc(this.config, 'reservation', 'adminGetReservationByPnr', { pnr }, correlationId, req.auth) as Record<string, unknown>; }
    catch (error) { throw serviceFailure(error, pnr); }
    let checkIn: Record<string, unknown>;
    try { checkIn = await callGatewayGrpc(this.config, 'operations', 'adminGetCheckInStatus', { bookingId: String(view.bookingId) }, correlationId, req.auth) as Record<string, unknown>; }
    catch (error) { throw serviceFailure(error, pnr); }
    return { outcome: { result: 'FOUND', subject: pnr }, response: publicAdminBooking(view, checkIn) };
  }
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
const notFound = () => new GatewayProblemError(404, 'NOT_FOUND', 'Booking not found');
const isNotFound = (error: unknown): boolean => error instanceof GatewayProblemError ? error.statusCode === 404 : typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 5;
type SearchOutcome = { result: AdminResult; subject: Pnr | null; errorCode?: AdminErrorCode };
/** Fin anticipado de la búsqueda: el desenlace que se registra y lo que se responde (nunca se registra texto del error). */
class SearchStop { constructor(readonly outcome: SearchOutcome, readonly respondWith: unknown) {} }
const serviceFailure = (error: unknown, pnr: Pnr): SearchStop => isNotFound(error) ? new SearchStop({ result: 'NOT_FOUND', subject: pnr }, notFound()) : new SearchStop({ result: 'ERROR', subject: pnr, errorCode: adminErrorCode(error) }, error);
/** Solo `{ "pnr": "<texto>" }` con un PNR válido (tras recortar y pasar a mayúsculas); cualquier otra cosa (sin cuerpo, no objeto, campo ausente o de otro tipo, vacío, largo, campos de más) ⇒ nulo. */
export const pnrFromBody = (body: unknown): Pnr | null => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body); if (keys.length !== 1 || keys[0] !== 'pnr') return null;
  const value = (body as { pnr?: unknown }).pnr; if (typeof value !== 'string' || value.length > 64) return null;
  return asPnr(value.trim().toUpperCase());
};
/** La ruta cuyo cuerpo NO lee el lector global: lo lee `searchBodyReader`, y solo después de la autenticación y del rol (ADR-F12c4-01, adenda audit-39). */
export const ADMIN_SEARCH_PATH = '/api/admin/v1/bookings/search';
export const isAdminSearch = (req: Request): boolean => req.path === ADMIN_SEARCH_PATH || req.path === `${ADMIN_SEARCH_PATH}/`;
export type SearchBodyReader = (req: Request, res: Response, next: NextFunction) => void;
/**
 * Lector del cuerpo de la búsqueda. Corre DENTRO del punto único: después de transporte, autenticación y rol (nada de esto lee el cuerpo). Un JSON ilegible,
 * demasiado grande o de otro tipo de contenido NO se rechaza aquí con 400 (no quedaría registrado): llega como «sin cuerpo» a `searchBooking`,
 * que lo registra como INVALID_FORMAT. Marca `_body` para que ningún otro lector vuelva a procesarlo.
 */
export const searchBodyReader: SearchBodyReader = (() => {
  const read = expressFactory.json({ limit: '16kb' });
  return (req, res, next) => read(req, res, (error?: unknown) => { if (error) { req.body = undefined; (req as Request & { _body?: boolean })._body = true; } next(); });
})();
const P = AdminApiController.prototype;
Controller('api/admin/v1')(AdminApiController);
Inject('GATEWAY_CONFIG')(AdminApiController, undefined as unknown as string, 0); Inject('V2_STATE')(AdminApiController, undefined as unknown as string, 1); Inject('ADMIN_ACCESS_LOG')(AdminApiController, undefined as unknown as string, 2);
const d = (method: keyof AdminApiController) => Object.getOwnPropertyDescriptor(P, method)!;
Get('flights')(P, 'listFlights', d('listFlights')); Req()(P, 'listFlights', 0); Query()(P, 'listFlights', 1);
Get('fares')(P, 'listFares', d('listFares')); Req()(P, 'listFares', 0); Query()(P, 'listFares', 1);
Put('fares')(P, 'upsertFare', d('upsertFare')); Req()(P, 'upsertFare', 0); Body()(P, 'upsertFare', 1);
Post('bookings/search')(P, 'searchBooking', d('searchBooking')); HttpCode(200)(P, 'searchBooking', d('searchBooking')); Req()(P, 'searchBooking', 0); Body()(P, 'searchBooking', 1);
Get('web-bookings')(P, 'webBookings', d('webBookings')); Req()(P, 'webBookings', 0); Query()(P, 'webBookings', 1);
Roles('admin')(AdminApiController); Scopes('flights:admin')(AdminApiController);

const logger = new Logger('AdminApiContract');
const requestInfo = (req: Request, res: Response) => ({ method: req.method, path: req.path, correlationId: String(res.getHeader('X-Correlation-Id') ?? '') || undefined });
interface AdminSpec { servers?: unknown; components: { schemas: { ProblemDetails: object } } }

/** Autentica y autoriza ANTES de validar el contrato (sin token ⇒ 401, otro rol o scope ⇒ 403, aunque el cuerpo sea inválido) y valida contra el OpenAPI interno. */
export function mountAdminApiHttp(app: Application, config: GatewayConfig, devAuth?: DevAuthService, readSearchBody: SearchBodyReader = searchBodyReader): void {
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
  // Solo aquí, con una sesión de administrador comprobada, se lee el cuerpo de la búsqueda (el lector global la omite).
  app.use(ADMIN_SEARCH_PATH, readSearchBody);
  app.use('/api/admin/v1', openApiMiddleware({
    apiSpec: spec as never, ignorePaths: /\/bookings\/search\/?$/, validateRequests: true, validateSecurity: false, validateFormats: true, ajvFormats: { mode: 'full' },
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
