import process from 'node:process';
import type { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { decimalToMinor } from '@flight-platform/shared';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import { bookingView, internalStatus, issuedCount, ticketViews, v2Status, type RawBooking } from './booking-view';
import { mapPassengerIds } from './ids';
import { bookingLinks } from './links';
import { assertPassengerRules, domesticSet, normalizeBreakdown } from './rules';
import { v2Controller, v2Route } from './route';
import { InMemoryV2StateStore, type V2StateStore } from './state';
import { ownerClient } from './v2-security';

type Json = Record<string, unknown>;
const logger = new Logger('V2Bookings');
const correlation = (req: Request): string => String(req.res?.getHeader('X-Correlation-Id') ?? '');
const dayStart = (date: string): string => `${date}T00:00:00.000Z`; const dayEnd = (date: string): string => `${date}T23:59:59.999Z`;

interface BookingBody { holdId: string; passengers: Array<{ passengerId: string; passengerType: string; associatedAdultId?: string; documentType: string; documentExpiryDate?: string; [key: string]: unknown }>; payment: { paymentReference: string; amount?: { currency: string; total: string } }; salesChannel?: Record<string, unknown> }

/** Reservas, emisión y boletos de v2. Las sagas siguen en Reservation (F12b las moverá al orquestador sin cambiar lo observable aquí). */
export class V2BookingController {
  private readonly domestic: ReadonlySet<string>;
  constructor(private readonly config: GatewayConfig, private readonly state: V2StateStore = new InMemoryV2StateStore()) { this.domestic = domesticSet(process.env.DOMESTIC_AIRPORTS); }
  private get base(): string { return this.config.v2!.publicBaseUrl; }
  private call(req: Request, service: 'reservation' | 'pricing', method: string, input: object): Promise<unknown> { return callGatewayGrpc(this.config, service, method, { ...input, ownerId: req.auth!.ownerId }, correlation(req), req.auth); }
  private async fetch(req: Request, bookingId: string): Promise<RawBooking> { return await this.call(req, 'reservation', 'getReservation', { bookingId }) as RawBooking; }
  private async compose(raw: RawBooking): Promise<Json> { return bookingView(raw, await this.state.findBooking(raw.bookingId).catch(() => null), this.base); }

  async list(req: Request, query: { pnr?: string; status?: string; createdFrom?: string; createdTo?: string; limit?: string; cursor?: string }): Promise<Json> {
    const result = await this.call(req, 'reservation', 'listReservations', { ...(query.pnr ? { pnr: query.pnr } : {}), ...(query.status ? { status: internalStatus(query.status) } : {}), ...(query.createdFrom ? { createdFrom: dayStart(query.createdFrom) } : {}), ...(query.createdTo ? { createdTo: dayEnd(query.createdTo) } : {}), page: { limit: Number(query.limit ?? 10), cursor: query.cursor } }) as { items?: Json[]; nextCursor?: string };
    return { ...(result.nextCursor ? { nextCursor: result.nextCursor } : { nextCursor: null }), items: (result.items ?? []).map((item) => { const status = v2Status(String(item.status)); return { ...item, status, _links: { self: bookingLinks(this.base, String(item.bookingId), status, false).self } }; }) };
  }

  /** Comprobaciones previas que el contrato manda como 4xx específicos y el dominio no distingue. No corren en un reintento de la misma Idempotency-Key. */
  private async preflight(req: Request, body: BookingBody): Promise<void> {
    // La referencia de pago es cualquier texto no vacío de hasta 64 caracteres (decisión D4): no se valida ningún patrón.
    if (body.payment.paymentReference.length === 0 || body.payment.paymentReference.length > 64) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'paymentReference debe tener entre 1 y 64 caracteres');
    const hold = await this.call(req, 'pricing', 'getOfferHold', { holdId: body.holdId }) as { status: string; expiresAt?: string; lockedPrice: { currency: string; total: string }; passengersBreakdown: Parameters<typeof normalizeBreakdown>[0]; itineraries: Array<{ segments?: Array<{ departure?: { iataCode?: string; at?: string }; arrival?: { iataCode?: string } }> }> };
    if (hold.status === 'CONSUMED') throw new GatewayProblemError(409, 'HOLD_ALREADY_CONSUMED', 'El hold ya se convirtió en reserva');
    if (hold.status !== 'HELD' || (hold.expiresAt && Date.parse(hold.expiresAt) <= Date.now())) throw new GatewayProblemError(410, 'HOLD_EXPIRED', 'El hold venció o fue liberado; haga una nueva búsqueda');
    assertPassengerRules({ passengers: body.passengers, breakdown: normalizeBreakdown(hold.passengersBreakdown), itineraries: hold.itineraries ?? [], domestic: this.domestic });
    // Sin equipaje extra el total es el precio congelado: un monto distinto es AMOUNT_MISMATCH sin consultar a nadie más.
    const withBaggage = body.passengers.some((passenger) => Array.isArray(passenger.extraBaggage) && passenger.extraBaggage.length > 0);
    const amount = body.payment.amount;
    if (amount && !withBaggage && (amount.currency !== hold.lockedPrice.currency || decimalToMinor(amount.total) !== decimalToMinor(hold.lockedPrice.total))) throw new GatewayProblemError(422, 'AMOUNT_MISMATCH', 'El monto del pago no coincide con el precio congelado');
  }

  async create(req: Request, res: Response, body: BookingBody): Promise<Json> {
    const replay = req.v2Replay === true; const partner = Boolean(req.auth!.clientId); const clientId = req.auth!.clientId ?? ownerClient(req.auth!.ownerId);
    const { passengers, internalToExternal } = mapPassengerIds(body.passengers, `${req.auth!.ownerId}:${body.holdId}`);
    if (!replay) await this.preflight(req, body);
    const created = await this.call(req, 'reservation', 'createReservation', { holdId: body.holdId, passengers, payment: { paymentReference: body.payment.paymentReference }, idempotencyKey: req.header('idempotency-key'), ...(partner ? { paymentChannel: 'BOOKING', deferIssuanceFailure: true } : {}) }) as { bookingId: string; status: string };
    // La fila de v2 se (re)escribe también en los reintentos: una caída entre Reservation y esta tabla se repara con el reintento.
    await this.state.saveBooking({ bookingId: created.bookingId, clientId, ownerId: req.auth!.ownerId, holdId: body.holdId, paymentReference: body.payment.paymentReference, ...(body.salesChannel ? { salesChannel: body.salesChannel } : {}), passengerMap: internalToExternal }).catch(() => logger.error('v2 booking state could not be saved'));
    const detail = await this.compose(await this.fetch(req, created.bookingId));
    res.status(replay ? 200 : created.status === 'CONFIRMED' ? 201 : 202); res.setHeader('Location', `${this.base}/api/v2/vuelos/bookings/${created.bookingId}`);
    return detail;
  }

  async detail(req: Request, bookingId: string): Promise<Json> { return this.compose(await this.fetch(req, bookingId)); }

  async tickets(req: Request, bookingId: string): Promise<Json> {
    const raw = await this.fetch(req, bookingId); const record = await this.state.findBooking(bookingId).catch(() => null);
    return { bookingId: raw.bookingId, tickets: ticketViews(raw, record?.passengerMap ?? {}) };
  }

  async ticket(req: Request, bookingId: string, ticketId: string): Promise<Json> {
    const raw = await this.fetch(req, bookingId); const record = await this.state.findBooking(bookingId).catch(() => null);
    const found = ticketViews(raw, record?.passengerMap ?? {}).find((ticket) => ticket.ticketId === ticketId);
    if (!found) throw new GatewayProblemError(404, 'NOT_FOUND', 'Boleto no encontrado');
    return found;
  }

  /** Idempotente por construcción: si ya estaban emitidos devuelve `issued: 0`. En PENDING_PAYMENT o TICKET_ISSUING reintenta antes de responder. */
  async issueTickets(req: Request, bookingId: string): Promise<Json> {
    let raw = await this.fetch(req, bookingId); const before = issuedCount(raw);
    if (raw.status === 'PENDING_PAYMENT' || raw.status === 'TICKET_ISSUING') raw = await this.call(req, 'reservation', 'resumeReservation', { bookingId }) as RawBooking;
    if (raw.status === 'PENDING_PAYMENT') throw new GatewayProblemError(422, 'PAYMENT_NOT_AUTHORIZED', 'El pago de Booking aún no está confirmado');
    if (raw.status !== 'CONFIRMED' && raw.status !== 'TICKET_ISSUING') throw new GatewayProblemError(409, 'BOOKING_NOT_CONFIRMED', 'La reserva no admite emisión en su estado actual');
    const record = await this.state.findBooking(bookingId).catch(() => null); const status = v2Status(raw.status);
    return { bookingId: raw.bookingId, pnr: raw.pnr, status, tickets: ticketViews(raw, record?.passengerMap ?? {}), issued: Math.max(0, issuedCount(raw) - before), _links: bookingLinks(this.base, raw.bookingId, status, raw.status === 'CONFIRMED') };
  }
}
v2Controller(V2BookingController, 'vuelos/bookings', ['GATEWAY_CONFIG', 'V2_STATE']);
v2Route(V2BookingController.prototype, 'list', 'get', '', ['req', 'query'], { scopes: ['flights:read'] });
v2Route(V2BookingController.prototype, 'create', 'post', '', ['req', 'res', 'body'], { scopes: ['flights:book'], idempotent: { operation: 'createBooking', recompute: true } });
v2Route(V2BookingController.prototype, 'detail', 'get', ':bookingId', ['req', 'param:bookingId'], { scopes: ['flights:read'] });
v2Route(V2BookingController.prototype, 'issueTickets', 'post', ':bookingId/tickets', ['req', 'param:bookingId'], { scopes: ['flights:book'], status: 200 });
v2Route(V2BookingController.prototype, 'tickets', 'get', ':bookingId/tickets', ['req', 'param:bookingId'], { scopes: ['flights:read'] });
v2Route(V2BookingController.prototype, 'ticket', 'get', ':bookingId/tickets/:ticketId', ['req', 'param:bookingId', 'param:ticketId'], { scopes: ['flights:read'] });
