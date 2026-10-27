import type { Request, Response } from 'express';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import { bookingView, type RawBooking } from './booking-view';
import { V2Cancellation, type CancelReason } from './cancellation';
import { publishV2Event } from './events';
import { externalId, isUuid } from './ids';
import { bookingLinks } from './links';
import { v2Controller, v2Route } from './route';
import { publicSegment } from './shapes';
import { InMemoryV2StateStore, type V2BookingRecord, type V2StateStore } from './state';
import type { StockSync } from './stock/stock-sync';

type Json = Record<string, unknown>;
const correlation = (req: Request): string => String(req.res?.getHeader('X-Correlation-Id') ?? '');
const SEAT_STATUS: Record<string, string> = { PROVISIONAL: 'BOOKED', CONFIRMED: 'TICKETED', CHECKED_IN: 'CHECKED_IN' };

interface Access { raw: RawBooking; record: V2BookingRecord | null; map: Record<string, string>; toInternal(passengerId: string): string }

/** Postventa, asientos y check-in de v2 sobre la reserva del dueño. */
export class V2PostSaleController {
  private readonly cancellation: V2Cancellation;
  constructor(private readonly config: GatewayConfig, private readonly state: V2StateStore = new InMemoryV2StateStore(), private readonly stock?: StockSync) { this.cancellation = new V2Cancellation(config, state, stock); }
  private get base(): string { return this.config.v2!.publicBaseUrl; }
  private call(req: Request, service: 'reservation' | 'ancillaries' | 'operations', method: string, input: object): Promise<unknown> { return callGatewayGrpc(this.config, service, method, { ...input, ownerId: req.auth!.ownerId }, correlation(req), req.auth); }

  /** La reserva del dueño (404 si no es suya) y la traducción de los ids de pasajero entre Booking y los servicios. */
  private async access(req: Request, bookingId: string): Promise<Access> {
    const raw = await this.call(req, 'reservation', 'getReservation', { bookingId }) as RawBooking; const record = await this.state.findBooking(bookingId).catch(() => null); const map = record?.passengerMap ?? {};
    const inverse = new Map(Object.entries(map).map(([internal, external]) => [external, internal]));
    const known = new Set((raw.passengers ?? []).map((passenger) => String(passenger.passengerId)));
    const toInternal = (passengerId: string): string => { const internal = inverse.get(passengerId) ?? (isUuid(passengerId) ? passengerId.toLowerCase() : undefined); if (!internal || !known.has(internal)) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'passengerId no pertenece a la reserva'); return internal; };
    return { raw, record, map, toInternal };
  }
  private paymentChannel(req: Request): Json { return req.auth!.clientId ? { paymentChannel: 'BOOKING' } : {}; }

  async baggageOptions(req: Request, bookingId: string): Promise<Json[]> {
    const { map } = await this.access(req, bookingId); const value = await this.call(req, 'reservation', 'getBaggageOptions', { bookingId }) as { options?: Json[] };
    return (value.options ?? []).map((option) => ({ ...option, passengerId: externalId(map, String(option.passengerId)) }));
  }

  async baggage(req: Request, bookingId: string, body: { passengerId: string; itineraryId: string; quantity: number; payment: { paymentReference: string } }): Promise<Json> {
    const { map, toInternal } = await this.access(req, bookingId);
    // El contrato lista BAGGAGE_LIMIT_EXCEEDED como 422 (v1 lo envía como 409): se resuelve aquí antes de llamar.
    if (body.quantity > 3) throw new GatewayProblemError(422, 'BAGGAGE_LIMIT_EXCEEDED', 'Máximo 3 maletas por compra');
    if (body.payment.paymentReference.length === 0 || body.payment.paymentReference.length > 64) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'paymentReference debe tener entre 1 y 64 caracteres');
    const added = await this.call(req, 'reservation', 'addBaggage', { bookingId, passengerId: toInternal(body.passengerId), itineraryId: body.itineraryId, quantity: body.quantity, payment: { paymentReference: body.payment.paymentReference }, idempotencyKey: req.header('idempotency-key'), ...this.paymentChannel(req) }) as Json;
    return { ...added, passengerId: externalId(map, String(added.passengerId)) };
  }

  async dateChangeSearch(req: Request, bookingId: string, body: object): Promise<Json[]> {
    const value = await this.call(req, 'reservation', 'searchDateChange', { bookingId, ...body }) as { offers?: Json[] };
    return (value.offers ?? []).map((offer) => ({ ...offer, segments: Array.isArray(offer.segments) ? (offer.segments as Json[]).map(publicSegment) : [] }));
  }

  async dateChange(req: Request, res: Response, bookingId: string, body: { changeOfferId: string; payment?: { paymentReference: string }; assignedSeats?: unknown[] }): Promise<Json> {
    const before = this.stock?.enabled ? await this.call(req, 'reservation', 'getReservation', { bookingId }).catch(() => undefined) : undefined;
    const confirmed = await this.call(req, 'reservation', 'confirmDateChange', { bookingId, changeOfferId: body.changeOfferId, assignedSeats: body.assignedSeats ?? [], ...(body.payment ? { payment: { paymentReference: body.payment.paymentReference }, ...this.paymentChannel(req) } : {}), idempotencyKey: req.header('idempotency-key') }) as RawBooking;
    await this.stock?.trigger([...this.stock.flightsOf(before as never), ...this.stock.flightsOf(confirmed as never)], correlation(req));
    res.status(confirmed.status === 'CHANGE_PENDING' ? 202 : 200);
    return bookingView(confirmed, await this.state.findBooking(bookingId).catch(() => null), this.base);
  }

  async quote(req: Request, bookingId: string): Promise<unknown> { return this.call(req, 'reservation', 'getCancellationQuote', { bookingId }); }

  async cancel(req: Request, res: Response, bookingId: string, body: { quoteId?: string; reasonCode?: CancelReason; reason?: string }): Promise<Json> {
    const result = await this.cancellation.cancel(req.auth!, { bookingId, quoteId: body.quoteId, reasonCode: body.reasonCode ?? 'CUSTOMER_REQUEST', reason: body.reason, idempotencyKey: String(req.header('idempotency-key')), correlationId: correlation(req) });
    res.status(result.httpStatus); return result.body;
  }

  /** Cambio atómico de asientos: misma cabina, sin infantes, sin check-in hecho; o se cambian todos o ninguno. No hay tarifa de asientos, así que no se cobra. */
  async seats(req: Request, bookingId: string, body: { seats: Array<{ passengerId: string; segmentId: string; seatNumber: string }> }): Promise<Json> {
    const { raw, record, map, toInternal } = await this.access(req, bookingId);
    if (raw.status !== 'CONFIRMED') throw new GatewayProblemError(409, 'BOOKING_NOT_CONFIRMED', 'La reserva no admite cambio de asientos en su estado actual');
    const passengers = new Map((raw.passengers ?? []).map((passenger) => [String(passenger.passengerId), passenger])); const itineraries = (raw.itineraries ?? []) as Array<{ segments?: Array<{ segmentId?: string }>; pricingOptions?: Array<{ cabinClass?: string }> }>;
    const changes = body.seats.map((seat) => {
      const passengerId = toInternal(seat.passengerId); const itinerary = itineraries.find((item) => (item.segments ?? []).some((segment) => segment.segmentId === seat.segmentId));
      if (!itinerary) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'segmentId no pertenece a la reserva');
      return { passengerId, segmentId: seat.segmentId, seatNumber: seat.seatNumber, passengerType: String(passengers.get(passengerId)!.passengerType), cabinClass: itinerary.pricingOptions?.[0]?.cabinClass ?? 'ECONOMY' };
    });
    const issued = (raw.tickets ?? []).length > 0 && (raw.tickets ?? []).every((ticket) => ticket.status === 'ISSUED');
    const result = await this.call(req, 'ancillaries', 'changeSeats', { bookingId, changes, newAssignmentStatus: issued ? 'CONFIRMED' : 'PROVISIONAL' }) as { results?: Json[] };
    const seats = (result.results ?? []).map((item) => ({ passengerId: externalId(map, String(item.passengerId)), segmentId: item.segmentId, previousSeatNumber: item.previousSeatNumber ?? null, seatNumber: item.seatNumber, status: SEAT_STATUS[String(item.status)] ?? 'BOOKED' }));
    await publishV2Event(this.config, req.auth!.ownerId, { eventType: 'booking.seat_changed', correlationId: correlation(req), data: { bookingId, pnr: raw.pnr, status: raw.status }, extra: { changeType: 'SEAT', paymentReference: record?.paymentReference ?? null, seats } });
    return { bookingId, seats, _links: bookingLinks(this.base, bookingId, 'CONFIRMED', issued) };
  }

  async checkIn(req: Request, bookingId: string): Promise<Json> {
    const { map, raw } = await this.access(req, bookingId); const result = await this.call(req, 'operations', 'checkIn', { bookingId }) as { checkedInPassengers?: Json[] } & Json;
    return { ...result, checkedInPassengers: (result.checkedInPassengers ?? []).map((item) => ({ ...item, passengerId: externalId(map, String(item.passengerId)) })), _links: bookingLinks(this.base, bookingId, raw.status, true) };
  }

  async boardingPasses(req: Request, bookingId: string): Promise<Json> {
    const { map } = await this.access(req, bookingId); const result = await this.call(req, 'operations', 'listBoardingPasses', { bookingId }) as { boardingPasses?: Json[] } & Json;
    return { ...result, boardingPasses: (result.boardingPasses ?? []).map((pass) => ({ ...pass, passengerId: externalId(map, String(pass.passengerId)) })) };
  }
}
v2Controller(V2PostSaleController, 'vuelos/bookings/:bookingId', ['GATEWAY_CONFIG', 'V2_STATE', 'STOCK_SYNC']);
const proto = V2PostSaleController.prototype;
v2Route(proto, 'baggageOptions', 'get', 'baggage-options', ['req', 'param:bookingId'], { scopes: ['flights:read'] });
v2Route(proto, 'baggage', 'post', 'baggage', ['req', 'param:bookingId', 'body'], { scopes: ['flights:book'], status: 200, idempotent: { operation: 'addBaggage' } });
v2Route(proto, 'dateChangeSearch', 'post', 'date-change/search', ['req', 'param:bookingId', 'body'], { scopes: ['flights:read'], status: 200 });
v2Route(proto, 'dateChange', 'post', 'date-change', ['req', 'res', 'param:bookingId', 'body'], { scopes: ['flights:book'], idempotent: { operation: 'confirmDateChange' } });
v2Route(proto, 'quote', 'get', 'cancellation-quote', ['req', 'param:bookingId'], { scopes: ['flights:read'] });
v2Route(proto, 'cancel', 'post', 'cancel', ['req', 'res', 'param:bookingId', 'body'], { scopes: ['flights:cancel'], idempotent: { operation: 'cancelBooking' } });
v2Route(proto, 'seats', 'put', 'seats', ['req', 'param:bookingId', 'body'], { scopes: ['flights:book'], status: 200, idempotent: { operation: 'changeSeats' } });
v2Route(proto, 'checkIn', 'post', 'check-in', ['req', 'param:bookingId'], { scopes: ['flights:book'], status: 200 });
v2Route(proto, 'boardingPasses', 'get', 'boarding-passes', ['req', 'param:bookingId'], { scopes: ['flights:read'] });
