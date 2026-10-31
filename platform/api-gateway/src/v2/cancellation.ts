import { createHash } from 'node:crypto';
import { bookingLinks } from './links';
import { v2Status, type RawBooking } from './booking-view';
import type { AuthContext } from '../auth';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import type { V2StateStore } from './state';
import type { StockSync } from './stock/stock-sync';

type Json = Record<string, unknown>;
export type CancelReason = 'CUSTOMER_REQUEST' | 'SAGA_COMPENSATION' | 'FLIGHT_CANCELLED' | 'OTHER';
interface Quote { quoteId: string; isRefundable: boolean; refundAmount: string; penaltyAmount: string; currency: string; expiresAt: string }
export interface CancelInput { bookingId: string; quoteId?: string; reasonCode: CancelReason; reason?: string; idempotencyKey: string; correlationId: string }
export interface CancelResult { httpStatus: 200 | 202; body: Json; booking: RawBooking }

const minor = (value: string): number => Math.round(Number(value) * 100);

/**
 * Cancelación de v2. Sin `quoteId` solo se admite con SAGA_COMPENSATION o FLIGHT_CANCELLED (el contrato); en ese caso la fachada pide la
 * cotización: FLIGHT_CANCELLED y SAGA_COMPENSATION dentro de la ventana configurable no pagan penalidad (D5); fuera de ella, la de la tarifa.
 */
export class V2Cancellation {
  constructor(private readonly config: GatewayConfig, private readonly state: V2StateStore, private readonly stock?: StockSync) {}
  private call(auth: AuthContext, method: string, input: object, correlationId: string): Promise<unknown> { return callGatewayGrpc(this.config, 'reservation', method, { ...input, ownerId: auth.ownerId }, correlationId, auth); }

  async cancel(auth: AuthContext, input: CancelInput): Promise<CancelResult> {
    const { bookingId, correlationId } = input;
    const raw = await this.call(auth, 'getReservation', { bookingId }, correlationId) as RawBooking;
    if (raw.status === 'CANCELLED') throw new GatewayProblemError(409, 'ALREADY_CANCELLED', 'La reserva ya está cancelada');
    if (raw.status !== 'CONFIRMED') throw new GatewayProblemError(409, 'BOOKING_NOT_CANCELLABLE', 'La reserva no se puede cancelar en su estado actual');
    let quote: Quote;
    if (input.quoteId) quote = await this.call(auth, 'getStoredCancellationQuote', { bookingId, quoteId: input.quoteId }, correlationId) as Quote;
    else {
      if (input.reasonCode !== 'SAGA_COMPENSATION' && input.reasonCode !== 'FLIGHT_CANCELLED') throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'quoteId es obligatorio salvo con reasonCode SAGA_COMPENSATION o FLIGHT_CANCELLED');
      const created = Date.parse(raw.createdAt ?? '');
      const withinWindow = Number.isFinite(created) && Date.now() - created <= this.config.v2!.sagaWaiverMinutes * 60_000;
      const waive = input.reasonCode === 'FLIGHT_CANCELLED' || withinWindow;
      quote = await this.call(auth, waive ? 'quoteCancellation' : 'getCancellationQuote', waive ? { bookingId, waivePenalty: true } : { bookingId }, correlationId) as Quote;
    }
    const issued = (raw.tickets ?? []).filter((ticket) => ticket.status === 'ISSUED').map((ticket) => String(ticket.ticketId));
    const cancelled = await this.call(auth, 'cancelReservation', { bookingId, quoteId: quote.quoteId, reasonCode: input.reasonCode, ...(input.reason ? { reason: input.reason.slice(0, 255) } : {}), idempotencyKey: input.idempotencyKey }, correlationId) as RawBooking;
    const status = v2Status(cancelled.status) === 'CANCELLED' ? 'CANCELLED' : 'CANCELLATION_PENDING';
    if (status === 'CANCELLED') await this.stock?.trigger(this.stock.flightsOf(raw as never), correlationId);
    const record = await this.state.findBooking(bookingId).catch(() => null); const refund = minor(quote.refundAmount); const penalty = minor(quote.penaltyAmount);
    const seats = (raw.passengers ?? []).filter((passenger) => passenger.passengerType !== 'INFANT').length;
    return {
      httpStatus: status === 'CANCELLED' ? 200 : 202, booking: cancelled,
      body: {
        bookingId, pnr: raw.pnr, status, ...(status === 'CANCELLED' ? { cancelledAt: new Date().toISOString() } : {}), reasonCode: input.reasonCode,
        refund: { refundId: `REF-VUE-${createHash('sha256').update(quote.quoteId).digest('hex').slice(0, 8).toUpperCase()}`, amount: quote.refundAmount, penaltyAmount: quote.penaltyAmount, currency: quote.currency, percentage: refund + penalty > 0 ? Math.round((refund / (refund + penalty)) * 1000) / 10 : 0, ...(record ? { originalPaymentReference: record.paymentReference } : {}), status: refund > 0 ? 'CALCULATED' : 'NOT_REFUNDABLE' },
        ticketsVoided: status === 'CANCELLED' ? issued : [],
        inventoryRestoration: { status: status === 'CANCELLED' ? 'RESTORED' : 'PENDING', seatsReleased: seats, newSeatStatus: 'AVAILABLE' },
        message: status === 'CANCELLED' ? 'Reserva cancelada. Asientos liberados y reembolso calculado.' : 'Cancelación en proceso: se completará en breve.',
        _links: bookingLinks(this.config.v2!.publicBaseUrl, bookingId, status, false)
      }
    };
  }
}
