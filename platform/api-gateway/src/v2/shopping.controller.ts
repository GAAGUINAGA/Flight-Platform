import type { Request } from 'express';
import { status } from '@grpc/grpc-js';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import { isUuid } from './ids';
import { assertBreakdown, normalizeBreakdown } from './rules';
import { v2Controller, v2Route } from './route';
import { publicItinerary } from './shapes';

type Json = Record<string, unknown>;
// El catálogo de ancillaries usa EXIT_ROW; el contrato v2 lo llama EMERGENCY_EXIT y no admite otros valores.
const SEAT_CHARACTERISTICS: Record<string, string> = { WINDOW: 'WINDOW', AISLE: 'AISLE', EXTRA_LEGROOM: 'EXTRA_LEGROOM', EMERGENCY_EXIT: 'EMERGENCY_EXIT', EXIT_ROW: 'EMERGENCY_EXIT' };
export const v2SeatCharacteristics = (values: unknown): string[] => [...new Set((Array.isArray(values) ? values : []).map((value) => SEAT_CHARACTERISTICS[String(value)]).filter((value): value is string => Boolean(value)))];
const correlation = (req: Request): string => String(req.res?.getHeader('X-Correlation-Id') ?? '');
/** Búsqueda, mapa de asientos y estado público de vuelos (sin token). */
export class V2ShoppingController {
  constructor(private readonly config: GatewayConfig) {}

  async search(req: Request, body: { itineraries: unknown[]; passengers?: Partial<ReturnType<typeof normalizeBreakdown>> }): Promise<Json> {
    const passengers = normalizeBreakdown(body.passengers); assertBreakdown(passengers);
    const response = await callGatewayGrpc(this.config, 'pricing', 'searchOffers', { legs: body.itineraries, passengers }, correlation(req)) as { totalOffers: number; offers: Json[] };
    return { totalOffers: response.totalOffers, offers: response.offers.map((offer) => ({ offerId: offer.offerId, airline: { code: offer.airlineCode, name: offer.airlineName }, itineraries: Array.isArray(offer.itineraries) ? offer.itineraries.map((item: Json) => publicItinerary(item)) : [], grandTotal: offer.grandTotal })) };
  }

  async seatmap(req: Request, offerId: string, segmentId: string): Promise<Json> {
    if (!isUuid(offerId) || !isUuid(segmentId)) throw new GatewayProblemError(404, 'NOT_FOUND', 'Oferta o segmento no encontrado');
    try { await callGatewayGrpc(this.config, 'pricing', 'resolveSegment', { segmentId }, correlation(req)); }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === status.NOT_FOUND) throw new GatewayProblemError(404, 'NOT_FOUND', 'Oferta o segmento no encontrado'); throw error; }
    const map = await callGatewayGrpc(this.config, 'ancillaries', 'getSeatMapForOffer', { offerId, segmentId }, correlation(req)) as { segmentId?: string; cabins?: Array<{ rows?: Array<{ seats?: Array<{ isAvailable?: boolean; characteristics?: unknown }> }> }> };
    // Solo hay dos estados calculables hoy (disponible y ocupado); HELD por asiento y BOARDED llegan con F12b.
    return { ...map, cabins: (map.cabins ?? []).map((cabin) => ({ ...cabin, rows: (cabin.rows ?? []).map((row) => ({ ...row, seats: (row.seats ?? []).map((seat) => ({ ...seat, characteristics: v2SeatCharacteristics(seat.characteristics), status: seat.isAvailable ? 'AVAILABLE' : 'BOOKED' })) })) })) };
  }

  async flightStatus(req: Request, flightNumber: string, date: string): Promise<Json> {
    const value = await callGatewayGrpc(this.config, 'operations', 'getFlightStatus', { flightNumber, date }, correlation(req)) as { departure?: { scheduledAt?: string; estimatedAt?: string | null } } & Json;
    const scheduled = Date.parse(value.departure?.scheduledAt ?? ''); const estimated = Date.parse(value.departure?.estimatedAt ?? '');
    return { ...value, delayMinutes: Number.isFinite(scheduled) && Number.isFinite(estimated) ? Math.max(0, Math.round((estimated - scheduled) / 60_000)) : 0 };
  }
}
v2Controller(V2ShoppingController, 'vuelos', ['GATEWAY_CONFIG']);
v2Route(V2ShoppingController.prototype, 'search', 'post', 'search', ['req', 'body'], { public: true, status: 200 });
v2Route(V2ShoppingController.prototype, 'seatmap', 'get', 'offers/:offerId/seatmap', ['req', 'param:offerId', 'query:segmentId'], { public: true });
v2Route(V2ShoppingController.prototype, 'flightStatus', 'get', 'flights/:flightNumber/status', ['req', 'param:flightNumber', 'query:date'], { public: true });
