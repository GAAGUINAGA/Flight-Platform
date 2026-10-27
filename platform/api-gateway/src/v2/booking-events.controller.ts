import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { status as grpcStatus } from '@grpc/grpc-js';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { Request, Response } from 'express';
import { decimalToMinor } from '@flight-platform/shared';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import { V2Cancellation } from './cancellation';
import type { StockSync } from './stock/stock-sync';
import { deterministicUuid } from './ids';
import { loadV2Spec } from './http';
import { v2Controller, v2Route } from './route';
import type { V2BookingRecord, V2StateStore } from './state';

type Json = Record<string, unknown>;
declare module 'express-serve-static-core' { interface Request { rawBody?: Buffer; } }

/** Los eventos de Booking se registran bajo un único espacio: el secreto compartido identifica a Booking, no a un cliente. */
const NAMESPACE = 'booking-events';
const PAYMENT_TYPES = new Set(['ec.edu.epn.booking.pagos.payment.confirmed', 'ec.edu.epn.booking.pagos.payment.failed']);
const PACKAGE_TYPE = 'ec.edu.epn.booking.paquetes.package.cancelled';

/** Lo que un cuerpo de evento de Booking debe cumplir además de su esquema CloudEvents. */
export interface BookingCloudEvent { specversion: string; type: string; source: string; id: string; time: string; correlationid: string; data: Json }

export class V2BookingEventsController {
  private readonly validators: Record<'payment' | 'package', ValidateFunction>;
  private readonly cancellation: V2Cancellation;
  constructor(private readonly config: GatewayConfig, private readonly state: V2StateStore, private readonly stock?: StockSync) {
    this.cancellation = new V2Cancellation(config, state, stock);
    const spec = loadV2Spec() as unknown as { components: { schemas: Record<string, object> } }; const ajv = new Ajv({ strict: false, allErrors: false }); addFormats(ajv);
    const compile = (name: string) => ajv.compile({ ...spec.components.schemas[name], components: spec.components });
    this.validators = { payment: compile('EventPaymentConfirmed'), package: compile('EventPackageCancelled') };
  }
  private get settings() { return this.config.v2!.bookingEvents; }

  /** HMAC-SHA256 del cuerpo recibido, con el secreto compartido. Sin secreto configurado nunca se acepta nada. */
  private authenticate(req: Request): void {
    const { secret, signatureHeader, signaturePrefix } = this.settings; const received = req.header(signatureHeader); const raw = req.rawBody;
    const reject = (): never => { throw new GatewayProblemError(401, 'UNAUTHORIZED', 'Firma ausente o inválida'); };
    if (!secret || !received || !raw || !received.startsWith(signaturePrefix)) return reject();
    const expected = createHmac('sha256', secret).update(raw).digest('hex'); const given = received.slice(signaturePrefix.length).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(given) || !timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return reject();
  }

  private parse(body: unknown): BookingCloudEvent {
    const event = body as BookingCloudEvent; const type = typeof event?.type === 'string' ? event.type : '';
    const known = PAYMENT_TYPES.has(type) || type === PACKAGE_TYPE;
    if (!known) { if (event && typeof event === 'object' && typeof event.id === 'string' && event.specversion === '1.0') throw new GatewayProblemError(422, 'VALIDATION_FAILED', 'Tipo de evento no soportado'); throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'No es un CloudEvent válido'); }
    const validate = type === PACKAGE_TYPE ? this.validators.package : this.validators.payment;
    if (!validate(event) || typeof event.id !== 'string' || event.id.length === 0 || event.id.length > 200 || event.specversion !== '1.0') throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'El evento no cumple el esquema CloudEvents del contrato');
    return event;
  }

  private async locate(data: Json): Promise<V2BookingRecord> {
    const byId = typeof data.bookingId === 'string' ? await this.state.findBooking(data.bookingId) : null;
    const record = byId ?? (typeof data.paymentReference === 'string' ? await this.state.findBookingByPaymentReference(data.paymentReference) : null);
    if (!record || (this.settings.clientId && record.clientId !== this.settings.clientId)) throw new GatewayProblemError(404, 'NOT_FOUND', 'Reserva no encontrada');
    return record;
  }

  private call(record: V2BookingRecord, method: string, input: object, correlationId: string): Promise<unknown> {
    return callGatewayGrpc(this.config, 'reservation', method, { ...input, ownerId: record.ownerId }, correlationId, { ownerId: record.ownerId, role: 'partner', scopes: new Set(), clientId: record.clientId });
  }

  private async paymentOutcome(event: BookingCloudEvent, record: V2BookingRecord): Promise<string> {
    const { data } = event; const confirmed = event.type.endsWith('payment.confirmed'); const correlationId = event.correlationid;
    const amount = data.amount as { currency?: string; total?: string } | undefined;
    if (!amount || typeof amount.total !== 'string' || typeof amount.currency !== 'string') throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'amount es obligatorio en los eventos de pago');
    if (typeof data.paymentReference === 'string' && data.paymentReference !== record.paymentReference) throw new GatewayProblemError(422, 'PAYMENT_REFERENCE_INVALID', 'La referencia no corresponde a la reserva');
    let booking = await this.call(record, 'getReservation', { bookingId: record.bookingId }, correlationId) as { status: string; grandTotal: { currency: string; total: string }; itineraries?: Array<Record<string, unknown>> };
    if (amount.currency !== booking.grandTotal.currency || decimalToMinor(amount.total) !== decimalToMinor(booking.grandTotal.total)) throw new GatewayProblemError(422, 'AMOUNT_MISMATCH', 'El monto del evento no coincide con el de la reserva');
    if (confirmed) {
      if (booking.status === 'CONFIRMED') return 'ALREADY_ISSUED';
      if (booking.status === 'FAILED') return 'IGNORED_FAILED';
      if (booking.status === 'CANCELLED') return 'IGNORED_CANCELLED';
      if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'TICKET_ISSUING') return 'IGNORED_STATE';
      booking = await this.call(record, 'resumeReservation', { bookingId: record.bookingId }, correlationId) as typeof booking;
      return booking.status === 'CONFIRMED' ? 'ISSUED' : booking.status === 'TICKET_ISSUING' ? 'ISSUING' : booking.status === 'FAILED' ? 'IGNORED_FAILED' : 'PAYMENT_PENDING';
    }
    if (booking.status === 'FAILED') return 'ALREADY_FAILED';
    if (booking.status === 'CANCELLED') return 'IGNORED_CANCELLED';
    try { await this.call(record, 'failReservation', { bookingId: record.bookingId, ...(typeof data.failureReason === 'string' && data.failureReason ? { reason: data.failureReason.slice(0, 255) } : {}) }, correlationId); await this.stock?.trigger(this.stock.flightsOf(booking as never), correlationId); return 'FAILED_APPLIED'; }
    catch (error) { if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === grpcStatus.FAILED_PRECONDITION) return 'IGNORED_STATE'; throw error; }
  }

  /** Compensación de combos: cancela la parte de vuelo con SAGA_COMPENSATION (sin penalidad dentro de la ventana configurable, D5). */
  private async packageOutcome(event: BookingCloudEvent, record: V2BookingRecord): Promise<string> {
    const auth = { ownerId: record.ownerId, role: 'partner', scopes: new Set<string>(), clientId: record.clientId };
    const booking = await this.call(record, 'getReservation', { bookingId: record.bookingId }, event.correlationid) as { status: string; itineraries?: Array<Record<string, unknown>> };
    if (booking.status === 'CANCELLED') return 'ALREADY_CANCELLED';
    if (booking.status === 'FAILED') return 'IGNORED_FAILED';
    // Una reserva que aún no emitió se compensa liberándola; si está emitiendo, 409 para que Booking reintente cuando termine.
    if (booking.status === 'PENDING_PAYMENT') { await this.call(record, 'failReservation', { bookingId: record.bookingId, reason: typeof event.data.reason === 'string' ? event.data.reason.slice(0, 255) : 'package.cancelled' }, event.correlationid); await this.stock?.trigger(this.stock.flightsOf(booking as never), event.correlationid); return 'FAILED_APPLIED'; }
    const result = await this.cancellation.cancel(auth, { bookingId: record.bookingId, reasonCode: 'SAGA_COMPENSATION', ...(typeof event.data.reason === 'string' ? { reason: event.data.reason } : {}), idempotencyKey: deterministicUuid(`cancel:${event.id}`), correlationId: event.correlationid });
    return result.httpStatus === 200 ? 'CANCELLED' : 'CANCELLATION_PENDING';
  }

  async receive(req: Request, res: Response, body: unknown): Promise<Json> {
    this.authenticate(req); const event = this.parse(body); res.status(202);
    if (!(await this.state.claimEvent(NAMESPACE, event.id, event.type))) {
      const previous = await this.state.eventOutcome(NAMESPACE, event.id);
      // Mismo id ya resuelto: se repite el resultado sin efectos. Si quedó a medias (caída) se vuelve a procesar: todas las acciones son idempotentes.
      if (previous) { res.setHeader('Idempotent-Replayed', 'true'); return { eventId: event.id, outcome: previous }; }
    }
    try {
      const record = await this.locate(event.data);
      const outcome = event.type === PACKAGE_TYPE ? await this.packageOutcome(event, record) : await this.paymentOutcome(event, record);
      await this.state.completeEvent(NAMESPACE, event.id, outcome);
      return { eventId: event.id, outcome };
    } catch (error) { await this.state.releaseEvent(NAMESPACE, event.id).catch(() => undefined); throw error; }
  }
}
v2Controller(V2BookingEventsController, 'vuelos/booking-events', ['GATEWAY_CONFIG', 'V2_STATE', 'STOCK_SYNC']);
v2Route(V2BookingEventsController.prototype, 'receive', 'post', '', ['req', 'res', 'body'], { public: true });
