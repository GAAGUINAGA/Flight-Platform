import type { Request, Response } from 'express';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import { publishV2Event } from './events';
import { deterministicUuid, isUuid } from './ids';
import { holdLinks } from './links';
import { assertBreakdown, normalizeBreakdown, type Breakdown } from './rules';
import { v2Controller, v2Route } from './route';
import type { StockSync } from './stock/stock-sync';

type Json = Record<string, unknown>;
const correlation = (req: Request): string => String(req.res?.getHeader('X-Correlation-Id') ?? '');
const gone = (): GatewayProblemError => new GatewayProblemError(410, 'OFFER_NO_LONGER_AVAILABLE', 'La oferta ya no está disponible');

interface HoldBody { offerId: string; itinerarySelections: Array<{ itineraryId: string; cabinClass: string; fareBrand: string }>; passengersBreakdown?: Partial<Breakdown>; ttlMinutes?: number; assignedSeats?: unknown }
type SeatRequest = { segmentId: string; seatNumber: string };
const SEAT_NUMBER = /^[0-9]{1,2}[A-K]$/;
const invalid = (detail: string): GatewayProblemError => new GatewayProblemError(422, 'VALIDATION_FAILED', detail);
/** `assignedSeats` del hold (acuerdo de integración con Booking, ADR-F12b2fix-01): lista opcional de {segmentId, seatNumber}. */
function parseSeats(value: unknown): SeatRequest[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 18) throw invalid('assignedSeats inválido');
  const seats = value.map((item) => {
    const seat = item as Partial<SeatRequest> | null;
    if (typeof item !== 'object' || item === null || typeof seat?.segmentId !== 'string' || !isUuid(seat.segmentId) || typeof seat.seatNumber !== 'string' || !SEAT_NUMBER.test(seat.seatNumber)) throw invalid('assignedSeats inválido');
    return { segmentId: seat.segmentId, seatNumber: seat.seatNumber };
  });
  if (new Set(seats.map((seat) => `${seat.segmentId}:${seat.seatNumber}`)).size !== seats.length) throw invalid('assignedSeats repetido');
  return seats;
}

/** Hold con precio congelado: crear, consultar y liberar (compensación de la saga de Booking). */
export class V2HoldController {
  constructor(private readonly config: GatewayConfig, private readonly stock?: StockSync) {}
  private get base(): string { return this.config.v2!.publicBaseUrl; }
  private call(req: Request, method: string, input: object): Promise<unknown> { return callGatewayGrpc(this.config, 'pricing', method, input, correlation(req), req.auth); }

  async create(req: Request, res: Response, body: HoldBody): Promise<Json> {
    const passengersBreakdown = normalizeBreakdown(body.passengersBreakdown); assertBreakdown(passengersBreakdown);
    const seats = parseSeats(body.assignedSeats);
    // Identificadores que no son UUID no pueden corresponder a ninguna oferta nuestra.
    if (!isUuid(body.offerId) || body.itinerarySelections.some((selection) => !isUuid(selection.itineraryId))) throw gone();
    const result = await this.call(req, 'holdOffer', { offerId: body.offerId, itinerarySelections: body.itinerarySelections, passengersBreakdown, ownerId: req.auth!.ownerId, idempotencyKey: req.header('idempotency-key'), ...(body.ttlMinutes !== undefined ? { ttlMinutes: body.ttlMinutes } : {}) }) as { holdId: string; status: string; expiresAt: string; ttlMinutes: number; lockedPrice: Json };
    // Asientos apartados: si alguno no se puede (SEAT_TAKEN) el hold no queda creado: se libera y el error se devuelve tal cual.
    if (seats.length) await this.holdSeats(req, result.holdId, result.expiresAt, seats, passengersBreakdown).catch(async (error: unknown) => { await this.call(req, 'releaseOfferHold', { holdId: result.holdId, ownerId: req.auth!.ownerId }).catch(() => undefined); throw error; });
    // Stock a Booking: el hold baja la disponibilidad ahora y, si nadie lo usa, la devuelve al vencer (con un margen para que corra el barrido de holds).
    if (this.stock?.enabled) { const flights = this.stock.flightsOf(await this.call(req, 'getOfferHold', { holdId: result.holdId, ownerId: req.auth!.ownerId }).catch(() => undefined) as never); await this.stock.trigger(flights, correlation(req)); await this.stock.trigger(flights, correlation(req), new Date(Date.parse(result.expiresAt) + 60_000)); }
    res.status(201); res.setHeader('Location', `${this.base}/api/v2/vuelos/offers/hold/${result.holdId}`);
    // El evento solo sale en la primera ejecución: un reintento devuelve la respuesta guardada sin pasar por aquí.
    await publishV2Event(this.config, req.auth!.ownerId, { eventType: 'hold.created', eventId: deterministicUuid(`${result.holdId}:hold.created`), correlationId: correlation(req), data: { holdId: result.holdId }, extra: { offerId: body.offerId, seatsHeld: passengersBreakdown.adults + passengersBreakdown.youths + passengersBreakdown.children, expiresAt: result.expiresAt, ttlMinutes: result.ttlMinutes } });
    return { holdId: result.holdId, status: 'HELD', expiresAt: result.expiresAt, ttlMinutes: result.ttlMinutes, lockedPrice: result.lockedPrice, _links: holdLinks(this.base, result.holdId, 'HELD') };
  }

  /** Los segmentos deben ser los de la oferta y no puede haber más asientos por segmento que pasajeros con asiento. */
  private async holdSeats(req: Request, holdId: string, expiresAt: string, seats: SeatRequest[], breakdown: Breakdown): Promise<void> {
    const hold = await this.call(req, 'getOfferHold', { holdId, ownerId: req.auth!.ownerId }) as { itineraries?: Array<{ segments?: Array<{ segmentId?: string }> }> };
    const offered = new Set((hold.itineraries ?? []).flatMap((itinerary) => (itinerary.segments ?? []).map((segment) => segment.segmentId)));
    const perSegment = new Map<string, number>();
    for (const seat of seats) perSegment.set(seat.segmentId, (perSegment.get(seat.segmentId) ?? 0) + 1);
    const limit = breakdown.adults + breakdown.youths + breakdown.children;
    if (seats.some((seat) => !offered.has(seat.segmentId)) || [...perSegment.values()].some((count) => count > limit)) throw invalid('assignedSeats no corresponde a la oferta');
    await callGatewayGrpc(this.config, 'ancillaries', 'holdSeats', { holdId, ownerId: req.auth!.ownerId, expiresAt, seats }, correlation(req), req.auth);
  }

  async get(req: Request, holdId: string): Promise<Json> {
    const result = await this.call(req, 'getOfferHold', { holdId, ownerId: req.auth!.ownerId }) as Json;
    return { holdId, status: result.status, ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}), remainingSeconds: result.remainingSeconds, lockedPrice: result.lockedPrice, _links: holdLinks(this.base, holdId, String(result.status)) };
  }

  async release(req: Request, holdId: string): Promise<void> {
    const hold = await this.call(req, 'getOfferHold', { holdId, ownerId: req.auth!.ownerId }) as { status?: string };
    if (hold.status === 'CONSUMED') throw new GatewayProblemError(409, 'HOLD_ALREADY_CONSUMED', 'El hold ya es una reserva; compense con cancel');
    // Liberar un hold ya liberado o vencido es idempotente: 204 sin tocar nada más.
    if (hold.status === 'HELD') { await this.call(req, 'releaseOfferHold', { holdId, ownerId: req.auth!.ownerId }); await this.stock?.trigger(this.stock.flightsOf(hold as never), correlation(req)); }
    // Los asientos apartados se liberan siempre (idempotente): un reintento tras un fallo parcial ya ve el hold RELEASED.
    await callGatewayGrpc(this.config, 'ancillaries', 'releaseHeldSeats', { holdId, ownerId: req.auth!.ownerId }, correlation(req), req.auth);
  }
}
v2Controller(V2HoldController, 'vuelos/offers/hold', ['GATEWAY_CONFIG', 'STOCK_SYNC']);
v2Route(V2HoldController.prototype, 'create', 'post', '', ['req', 'res', 'body'], { scopes: ['flights:hold'], idempotent: { operation: 'createHold' } });
v2Route(V2HoldController.prototype, 'get', 'get', ':holdId', ['req', 'param:holdId'], { scopes: ['flights:read'] });
v2Route(V2HoldController.prototype, 'release', 'delete', ':holdId', ['req', 'param:holdId'], { scopes: ['flights:hold'], status: 204 });
