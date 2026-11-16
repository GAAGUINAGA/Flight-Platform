import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import expressFactory from 'express';
import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import { Body, Controller, Get, HttpCode, Inject, Logger, Param, Post, Put, Query, Req } from '@nestjs/common';
import { middleware as openApiMiddleware } from 'express-openapi-validator';
import { adminErrorCode, asFlightInstanceRef, asFlightNumber, asPnr, InMemoryAdminAccessLog, type AdminAccessLog, type AdminAction, type AdminErrorCode, type AdminResult, type AdminSubject, type Pnr } from './admin-access-log';
import { cabinsAllHaveFares, cabinsMissingFares, DEFAULT_FLIGHT_RULES, faresMatch, fareRequest, flightIdFromKey, flightNumberOf, idempotencyKeyFormat, planFlight, storedFares, type AircraftLayout, type FlightPlan } from './admin-flights';
import { InMemoryGatewayIdempotencyStore } from './idempotency';
import type { GatewayIdempotencyPort } from './idempotency.interceptor';
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
  constructor(private readonly config: GatewayConfig, private readonly state: V2StateStore, private readonly accessLog: AdminAccessLog = new InMemoryAdminAccessLog(), private readonly idempotency: GatewayIdempotencyPort = new InMemoryGatewayIdempotencyStore(config.idempotencyTtlHours)) { this.admin = new AdminController(config); }
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
  // ───────────── F12c-4b y F12c-4c (ADR-F12c4-01, adenda 4b/4c): mismo patrón de punto único que la búsqueda ─────────────
  /**
   * Punto único de una acción del administrador: autenticación y rol ya se comprobaron; aquí se lee el cuerpo, se valida, se aplica el límite y se ejecuta.
   * Cualquier desenlace (rechazo, no encontrada, límite, error de un servicio o del propio gateway) escribe UNA fila del registro ANTES de responder; si esa
   * escritura falla, 503 sin datos. Nadie más escribe el registro de esta acción.
   */
  private async audited<T>(req: Request, action: AdminAction, run: (ctx: AuditContext) => Promise<{ response: T }>, notFoundError: () => GatewayProblemError = notFound): Promise<T> {
    const ctx: AuditContext = { actorSub: req.auth!.ownerId, correlationId: String(req.res?.getHeader('X-Correlation-Id') ?? ''), subject: null };
    let outcome: SearchOutcome; let response: T | undefined; let failure: unknown; let failed = false;
    try { response = (await run(ctx)).response; outcome = { result: 'OK', subject: ctx.subject }; }
    catch (error) {
      failed = true;
      if (error instanceof SearchStop) { outcome = error.outcome; failure = error.respondWith; }
      else {
        const code = adminErrorCode(error);
        if (code === 'NOT_FOUND') { outcome = { result: 'NOT_FOUND', subject: ctx.subject }; failure = notFoundError(); }
        else { outcome = { result: BUSINESS_CODES.has(code) ? 'REJECTED' : 'ERROR', subject: ctx.subject, errorCode: code }; failure = error; }
      }
    }
    try { await this.accessLog.record({ ...outcome, actorSub: ctx.actorSub, action, correlationId: ctx.correlationId }); }
    catch { throw new GatewayProblemError(503, 'PROVIDER_UNAVAILABLE', 'Audit log unavailable'); }
    if (failed) throw failure;
    return response as T;
  }
  /** Límite por administrador y hora, contado desde el propio registro (vale entre instancias). El rechazo por el límite también se registra. */
  private async assertWithinLimit(req: Request, ctx: AuditContext, action: AdminAction, limit: number, problemType: string): Promise<void> {
    let used: number;
    try { used = await this.accessLog.countSince(ctx.actorSub, action, new Date(Date.now() - 3_600_000)); }
    catch { throw new SearchStop({ result: 'ERROR', subject: ctx.subject, errorCode: 'PROVIDER_UNAVAILABLE' }, new GatewayProblemError(503, 'PROVIDER_UNAVAILABLE', 'Audit log unavailable')); }
    if (used >= limit) {
      req.res?.setHeader('Retry-After', '60');
      throw new SearchStop({ result: 'RATE_LIMITED', subject: ctx.subject }, new GatewayProblemError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests; try again later', problemType));
    }
  }
  /** `Idempotency-Key` UUID v4 obligatoria (una por INTENCIÓN: la genera el panel al confirmar y la repite al reintentar). */
  private idempotencyKeyOf(req: Request, ctx: AuditContext): string {
    const key = req.header('idempotency-key');
    if (!key || !idempotencyKeyFormat.test(key)) throw new SearchStop({ result: 'REJECTED', subject: ctx.subject, errorCode: 'VALIDATION_FAILED' }, new GatewayProblemError(400, 'VALIDATION_FAILED', 'Idempotency-Key es obligatorio y debe ser un UUID v4'));
    return key.toLowerCase();
  }
  /** Ejecuta `exec` una sola vez por (administrador, alcance, clave): el reintento con el mismo cuerpo devuelve la respuesta guardada; otro cuerpo ⇒ 409. */
  private async runIdempotent<T>(req: Request, ctx: AuditContext, scope: string, key: string, hashBody: unknown, status: number, exec: () => Promise<T>): Promise<{ response: T }> {
    const record = await this.idempotency.begin(ctx.actorSub, `admin:${scope}:${key}`, hashBody);
    if (record === 'MISMATCH') throw new SearchStop({ result: 'REJECTED', subject: ctx.subject, errorCode: 'IDEMPOTENCY_KEY_REUSED' }, new GatewayProblemError(409, 'IDEMPOTENCY_KEY_REUSED', 'La Idempotency-Key ya se usó con otra solicitud'));
    if (record === 'IN_PROGRESS') { req.res?.setHeader('Retry-After', '1'); throw new SearchStop({ result: 'REJECTED', subject: ctx.subject, errorCode: 'IDEMPOTENCY_KEY_REUSED' }, new GatewayProblemError(409, 'IDEMPOTENCY_KEY_REUSED', 'La solicitud con esta Idempotency-Key sigue en curso')); }
    if (record.responseCode) { req.res?.setHeader('Idempotent-Replayed', 'true'); req.res?.status(200); return { response: record.responseBody as T }; }
    try {
      const response = await exec();
      await this.idempotency.complete(record.id, status, response as object);
      return { response };
    } catch (error) {
      // Lo que falló no queda «en curso»: con la misma clave y el mismo cuerpo se puede reintentar.
      try { await this.idempotency.retry(record.id); } catch { /* el error original es el que importa */ }
      throw error;
    }
  }
  private call(req: Request, ctx: AuditContext, service: 'inventory' | 'pricing' | 'ancillaries' | 'operations', method: string, input: object): Promise<unknown> {
    return callGatewayGrpc(this.config, service, method, input, ctx.correlationId, req.auth);
  }

  /** Catálogo de aviones (solo lectura, datos de referencia; no se registra). */
  async aircraftCatalog(req: Request) {
    const response = await callGatewayGrpc(this.config, 'ancillaries', 'listAircraftLayouts', {}, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth) as { aircraft?: AircraftLayout[] };
    return { aircraft: Array.isArray(response?.aircraft) ? response.aircraft.map((value) => ({ code: value.code, cabins: value.cabins.map((cabin) => ({ cabinClass: cabin.cabinClass, seats: cabin.seats })) })) : [] };
  }

  /**
   * Check-in hecho por la aerolínea (F12c-4b). Cuerpo `{ "pnr" }` + `Idempotency-Key`: el dueño lo resuelve Operations con Reservation (nunca lo envía el
   * panel) y se ejecutan las MISMAS reglas que el cliente (ventana de 48 h a 60 min, estado, boletos); el actor queda en el registro, no en el evento.
   */
  async checkInBooking(req: Request, body: unknown) {
    return this.audited(req, 'CHECK_IN', async (ctx) => {
      await this.assertWithinLimit(req, ctx, 'CHECK_IN', this.config.admin?.checkInLimitPerHour ?? 60, 'admin-checkin-limit');
      const pnr = pnrFromBody(body);
      if (!pnr) throw new SearchStop({ result: 'INVALID_FORMAT', subject: null }, notFound());
      ctx.subject = pnr;
      const key = this.idempotencyKeyOf(req, ctx);
      return this.runIdempotent(req, ctx, 'check-in', key, { pnr }, 200, async () => publicCheckIn(await this.call(req, ctx, 'operations', 'adminCheckIn', { pnr })));
    });
  }

  /** Pases de abordar de una reserva por PNR (F12c-4b): solo identificadores, asiento y código; los nombres salen de la vista de la reserva. Consulta registrada y limitada. */
  async boardingPasses(req: Request, body: unknown) {
    return this.audited(req, 'BOARDING_PASSES', async (ctx) => {
      await this.assertWithinLimit(req, ctx, 'BOARDING_PASSES', this.config.admin?.checkInLimitPerHour ?? 60, 'admin-checkin-limit');
      const pnr = pnrFromBody(body);
      if (!pnr) throw new SearchStop({ result: 'INVALID_FORMAT', subject: null }, notFound());
      ctx.subject = pnr;
      const view = await this.call(req, ctx, 'operations', 'adminListBoardingPasses', { pnr }) as { bookingId?: string; boardingPasses?: Array<Record<string, unknown>> };
      return { response: { bookingId: String(view.bookingId), boardingPasses: (view.boardingPasses ?? []).map((pass) => ({ passengerId: pass.passengerId, segmentId: pass.segmentId, seat: pass.seat, barcode: pass.barcode, barcodeType: pass.barcodeType })) } };
    });
  }

  /**
   * Crear un vuelo con su tarifa (F12c-4c, P6 y P8). Orquesta aquí (deuda explícita para F12b-3): valida todo sin escribir → crea el vuelo CERRADO (id = UUIDv5 de la
   * clave) → guarda las tarifas → las RELEE y compara → abre solo si `openForSale` y todas quedaron guardadas. Un fallo intermedio deja un vuelo cerrado (invisible en
   * búsquedas y holds); reintentar con la misma clave lo completa. Un doble clic devuelve la misma respuesta.
   */
  async createFlight(req: Request, body: unknown) {
    return this.audited(req, 'CREATE_FLIGHT', async (ctx) => {
      ctx.subject = asFlightNumber(flightNumberOf(body));
      const key = this.idempotencyKeyOf(req, ctx);
      return this.runIdempotent(req, ctx, 'create-flight', key, body, 201, async () => {
        const rules = this.config.admin?.flights ?? DEFAULT_FLIGHT_RULES;
        const catalog = await this.call(req, ctx, 'ancillaries', 'listAircraftLayouts', {}) as { aircraft?: AircraftLayout[] };
        const planned = planFlight(body, rules, Array.isArray(catalog?.aircraft) ? catalog.aircraft : [], new Date());
        if ('errors' in planned) throw new SearchStop({ result: 'REJECTED', subject: ctx.subject, errorCode: 'VALIDATION_FAILED' }, new GatewayProblemError(400, 'VALIDATION_FAILED', 'Invalid fields', undefined, planned.errors));
        return this.executePlan(req, ctx, planned.plan, flightIdFromKey(ctx.actorSub, key));
      });
    });
  }
  private async executePlan(req: Request, ctx: AuditContext, plan: FlightPlan, flightInstanceId: string) {
    const partial = (reason: string): GatewayProblemError => new GatewayProblemError(503, 'PROVIDER_UNAVAILABLE', `El vuelo ${flightInstanceId} quedó CERRADO e incompleto (${reason}); reintenta con la misma Idempotency-Key para completarlo`);
    await this.call(req, ctx, 'inventory', 'createFlightInstance', { flightInstanceId, flightNumber: plan.flightNumber, departureIata: plan.origin, arrivalIata: plan.destination, departureAt: plan.departureAt.toISOString(), arrivalAt: plan.arrivalAt.toISOString(), cabins: plan.cabins, aircraft: plan.aircraft });
    try { for (const fare of plan.fares) await this.call(req, ctx, 'pricing', 'upsertFare', fareRequest(flightInstanceId, fare)); }
    catch { throw partial('tarifas sin guardar'); }
    let reread: ReturnType<typeof storedFares>;
    try { reread = storedFares(await this.call(req, ctx, 'pricing', 'listFares', { flightInstanceId, page: {} })); }
    catch { throw partial('tarifas sin verificar'); }
    if (!faresMatch(plan.fares, reread) || !cabinsAllHaveFares(plan.cabins, reread)) throw partial('las tarifas guardadas no coinciden con las enviadas');
    let closed = true;
    if (plan.openForSale) {
      // La MISMA comprobación que la apertura manual: se relee de Inventory y Pricing justo antes de abrir. Si falla, el vuelo queda cerrado y se responde el error de negocio.
      try { await this.openChecked(req, ctx, flightInstanceId); closed = false; }
      catch (error) { if (error instanceof GatewayProblemError && error.code === 'FLIGHT_NOT_READY') throw error; throw partial('sin abrir a la venta'); }
    }
    return {
      flightInstanceId, flightNumber: plan.flightNumber, status: closed ? 'CLOSED' : 'OPEN', closed, aircraft: plan.aircraft, origin: plan.origin, destination: plan.destination,
      departureAt: plan.departureAt.toISOString(), arrivalAt: plan.arrivalAt.toISOString(), departureLocal: plan.departureLocal, arrivalLocal: plan.arrivalLocal, durationMinutes: plan.durationMinutes,
      cabins: plan.cabins, fares: plan.fares.map((fare) => ({ cabinClass: fare.cabinClass, fareBrand: fare.fareBrand, currency: fare.currency, baseFare: fare.baseFare, taxes: fare.taxes, total: fare.total }))
    };
  }

  /**
   * ÚNICO punto que abre un vuelo (creación y OPEN_FLIGHT): relee la instancia (Inventory) y sus tarifas (Pricing) en este instante y abre SOLO si cada cabina con asientos
   * tiene al menos una tarifa guardada y válida. Si falta alguna: 409 FLIGHT_NOT_READY con `invalidParams` (`missing-fare-<CABINA>`), sin abrir.
   */
  private async openChecked(req: Request, ctx: AuditContext, flightInstanceId: string): Promise<void> {
    const flight = await this.call(req, ctx, 'inventory', 'getFlightInstance', { flightInstanceId }) as { cabins?: Array<{ cabinClass: string; capacity: number }> };
    const stored = storedFares(await this.call(req, ctx, 'pricing', 'listFares', { flightInstanceId, page: {} }));
    const missing = cabinsMissingFares(flight.cabins ?? [], stored);
    if (missing.length > 0) throw new GatewayProblemError(409, 'FLIGHT_NOT_READY', 'El vuelo tiene tarifas incompletas', undefined, missing.map((cabin) => ({ name: 'fares', reason: `missing-fare-${cabin}` })));
    await this.call(req, ctx, 'inventory', 'openFlightInstance', { flightInstanceId });
  }

  /** Abrir a la venta un vuelo cerrado (P8): solo si TODA cabina con asientos tiene una tarifa guardada (se relee en el momento de abrir). */
  async openFlight(req: Request, flightInstanceId: string) {
    return this.audited(req, 'OPEN_FLIGHT', async (ctx) => {
      ctx.subject = asFlightInstanceRef(flightInstanceId);
      if (!ctx.subject) throw new SearchStop({ result: 'REJECTED', subject: null, errorCode: 'VALIDATION_FAILED' }, new GatewayProblemError(400, 'VALIDATION_FAILED', 'Invalid fields: flightInstanceId'));
      const key = this.idempotencyKeyOf(req, ctx);
      return this.runIdempotent(req, ctx, 'open-flight', key, { flightInstanceId }, 200, async () => {
        await this.openChecked(req, ctx, flightInstanceId);
        return { flightInstanceId, status: 'OPEN' as const, closed: false };
      });
    }, () => new GatewayProblemError(404, 'NOT_FOUND', 'Flight not found'));
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
/** Lista blanca del resultado del check-in: solo identificadores, estados y asientos (el servicio podría devolver campos de más). */
const publicCheckIn = (value: unknown) => {
  const result = (value ?? {}) as { bookingId?: unknown; status?: unknown; checkedInPassengers?: Array<{ passengerId?: unknown; status?: unknown; segments?: Array<{ segmentId?: unknown; status?: unknown; seat?: unknown }> }> };
  return {
    bookingId: String(result.bookingId), status: String(result.status),
    checkedInPassengers: (result.checkedInPassengers ?? []).map((passenger) => ({
      passengerId: String(passenger.passengerId), status: String(passenger.status),
      segments: (passenger.segments ?? []).map((segment) => ({ segmentId: String(segment.segmentId), status: String(segment.status), ...(typeof segment.seat === 'string' && segment.seat ? { seat: segment.seat } : {}) }))
    }))
  };
};
const isNotFound = (error: unknown): boolean => error instanceof GatewayProblemError ? error.statusCode === 404 : typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 5;
type SearchOutcome = { result: AdminResult; subject: AdminSubject | null; errorCode?: AdminErrorCode };
/** Lo que una acción registrada va sabiendo: el sujeto se fija en cuanto está validado (si nunca lo está, el registro queda sin sujeto). */
interface AuditContext { actorSub: string; correlationId: string; subject: AdminSubject | null }
/** Códigos de negocio (reglas rechazadas): se registran como REJECTED; los demás errores (infraestructura) como ERROR. */
const BUSINESS_CODES: ReadonlySet<AdminErrorCode> = new Set<AdminErrorCode>(['VALIDATION_FAILED', 'BOOKING_NOT_CONFIRMED', 'CHECK_IN_NOT_AVAILABLE', 'CHECK_IN_FAILED', 'BOARDING_PASS_NOT_AVAILABLE', 'FLIGHT_ALREADY_DEPARTED', 'FLIGHT_ALREADY_EXISTS', 'FLIGHT_NOT_READY', 'IDEMPOTENCY_KEY_REUSED']);
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
/**
 * Acciones registradas con punto único (F12c-4b/4c, mismo patrón que la búsqueda): su cuerpo lo lee el lector del punto único DESPUÉS de autenticación y rol, el
 * validador OpenAPI no las toca (validarían y responderían 400 sin registro) y cada intento queda en `gateway.admin_access_log`. Solo POST.
 */
const POINT_ROUTES = [/^\/api\/admin\/v1\/bookings\/(search|check-in|boarding-passes)\/?$/, /^\/api\/admin\/v1\/flights\/?$/, /^\/api\/admin\/v1\/flights\/[^/]+\/open\/?$/];
/** `baseUrl + path`: dentro de un `app.use('/api/admin/v1', …)` Express quita el prefijo de `req.path`. */
export const isAdminPointRoute = (req: Request): boolean => req.method === 'POST' && POINT_ROUTES.some((route) => route.test(`${req.baseUrl ?? ''}${req.path}`));
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
Inject('GATEWAY_CONFIG')(AdminApiController, undefined as unknown as string, 0); Inject('V2_STATE')(AdminApiController, undefined as unknown as string, 1); Inject('ADMIN_ACCESS_LOG')(AdminApiController, undefined as unknown as string, 2); Inject('ADMIN_IDEMPOTENCY')(AdminApiController, undefined as unknown as string, 3);
const d = (method: keyof AdminApiController) => Object.getOwnPropertyDescriptor(P, method)!;
Get('flights')(P, 'listFlights', d('listFlights')); Req()(P, 'listFlights', 0); Query()(P, 'listFlights', 1);
Get('fares')(P, 'listFares', d('listFares')); Req()(P, 'listFares', 0); Query()(P, 'listFares', 1);
Put('fares')(P, 'upsertFare', d('upsertFare')); Req()(P, 'upsertFare', 0); Body()(P, 'upsertFare', 1);
Post('bookings/search')(P, 'searchBooking', d('searchBooking')); HttpCode(200)(P, 'searchBooking', d('searchBooking')); Req()(P, 'searchBooking', 0); Body()(P, 'searchBooking', 1);
Get('aircraft')(P, 'aircraftCatalog', d('aircraftCatalog')); Req()(P, 'aircraftCatalog', 0);
Post('bookings/check-in')(P, 'checkInBooking', d('checkInBooking')); HttpCode(200)(P, 'checkInBooking', d('checkInBooking')); Req()(P, 'checkInBooking', 0); Body()(P, 'checkInBooking', 1);
Post('bookings/boarding-passes')(P, 'boardingPasses', d('boardingPasses')); HttpCode(200)(P, 'boardingPasses', d('boardingPasses')); Req()(P, 'boardingPasses', 0); Body()(P, 'boardingPasses', 1);
Post('flights')(P, 'createFlight', d('createFlight')); HttpCode(201)(P, 'createFlight', d('createFlight')); Req()(P, 'createFlight', 0); Body()(P, 'createFlight', 1);
Post('flights/:flightInstanceId/open')(P, 'openFlight', d('openFlight')); HttpCode(200)(P, 'openFlight', d('openFlight')); Req()(P, 'openFlight', 0); Param('flightInstanceId')(P, 'openFlight', 1);
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
  app.use('/api/admin/v1', (req: Request, res: Response, next: NextFunction) => (isAdminPointRoute(req) ? readSearchBody(req, res, next) : next()));
  // Las rutas de punto único NO pasan por el validador (responderían 400 sin registro): las valida el propio punto único y quedan registradas.
  const skipPointRoutes = (handler: RequestHandler): RequestHandler => (req, res, next) => (isAdminPointRoute(req) ? next() : handler(req, res, next));
  app.use('/api/admin/v1', ...openApiMiddleware({
    apiSpec: spec as never, validateRequests: true, validateSecurity: false, validateFormats: true, ajvFormats: { mode: 'full' },
    validateResponses: config.validateResponses ? {
      onError: (error: Error, body: unknown) => {
        if (/no schema defined for status code/.test(error.message) && problemSchema?.(body)) return;
        logger.error(`admin API response does not match the contract: ${error.message.slice(0, 600)}`);
        throw error;
      }
    } : false
  }).map((handler) => skipPointRoutes(handler as RequestHandler)));
  app.use('/api/admin/v1', (error: unknown, req: Request, res: Response, next: NextFunction) => {
    void next;
    const problem = v2ProblemFromError(error, requestInfo(req, res));
    const validator = typeof error === 'object' && error !== null && 'errors' in error ? (error as { errors?: Array<{ path?: string; message?: string }> }).errors : undefined;
    if (Array.isArray(validator) && problem.status === 400) problem.invalidParams = validator.map((entry) => ({ name: entry.path ?? 'request', reason: entry.message ?? 'invalid' }));
    if (problem.status === 503 && !res.getHeader('Retry-After')) res.setHeader('Retry-After', '5');
    res.status(problem.status).type('application/problem+json').json(problem);
  });
}
