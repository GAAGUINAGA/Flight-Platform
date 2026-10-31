import { assertPostSaleEligible, PostSaleItinerary } from '../domain/post-sale-eligibility';
import { Clock, DomainError, decimalToMinor, minorToDecimal } from '@flight-platform/shared';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from './ports';
import { CancellationQuotes } from './cancellation-quotes';
import { eventExtra, refundIdFor, seatsOf } from './allocation';
import { ReservationStore, StoredReservation } from './reservation-store';
import { ResponseValidator } from './post-sale-baggage';

type Itinerary = PostSaleItinerary & { pricingOptions: Array<{ fareRules?: { isRefundable: boolean; isChangeable: boolean } }> };
type Quote = { quoteId: string; isRefundable: boolean; refundAmount: string; penaltyAmount: string; currency: string; expiresAt: string };

export class PostSaleCancellation {
  constructor(private readonly reservations: ReservationStore, private readonly pricing: PricingPort, private readonly quotes: CancellationQuotes, private readonly payment: PaymentVerifier, private readonly inventory: InventoryPort, private readonly ancillaries: AncillariesPort, private readonly ticketing: TicketingPort, private readonly events: EventPublisher, private readonly clock: Clock, private readonly validateResponse: ResponseValidator) {}

  async quote(input: { bookingId: string; ownerId: string; waivePenalty?: boolean }): Promise<Quote> {
    const booking = await this.owned(input);
    const itineraries = booking.itineraries as Itinerary[];
    assertPostSaleEligible(booking.status, itineraries, this.clock.now());
    const fareRules = itineraries[0]?.pricingOptions[0]?.fareRules;
    if (!fareRules || !this.pricing.quoteCancellation) throw new DomainError('VALIDATION_FAILED');
    let quote = await this.pricing.quoteCancellation({ bookingId: booking.id, ownerId: input.ownerId, paidPrice: { ...booking.grandTotal }, fareRules }) as Quote;
    // D5: sin penalidad (reembolso total) cuando la causa no es del cliente; el id y la vigencia siguen siendo los de la cotización de Pricing.
    if (input.waivePenalty) quote = { ...quote, isRefundable: true, refundAmount: booking.grandTotal.total, penaltyAmount: '0.00' };
    if (!quote.quoteId || !Number.isFinite(Date.parse(quote.expiresAt)) || quote.currency !== booking.grandTotal.currency || decimalToMinor(quote.refundAmount) < 0 || decimalToMinor(quote.penaltyAmount) < 0) throw new DomainError('VALIDATION_FAILED');
    this.validateResponse('CancellationQuoteResponse', quote);
    await this.quotes.save({ quoteId: quote.quoteId, bookingId: booking.id, ownerId: input.ownerId, payload: quote, expiresAt: new Date(quote.expiresAt) });
    return quote;
  }

  /** Cotización ya emitida, aunque esté vencida o usada. */
  async storedQuote(input: { bookingId: string; ownerId: string; quoteId: string }): Promise<Quote> {
    await this.owned(input);
    const stored = await this.quotes.find(input.ownerId, input.bookingId, input.quoteId);
    if (!stored) throw new DomainError('QUOTE_EXPIRED');
    return stored.payload as Quote;
  }

  async cancel(input: { bookingId: string; ownerId: string; quoteId: string; reason?: string; reasonCode?: string; idempotencyKey: string }): Promise<StoredReservation> {
    const booking = await this.owned(input);
    assertPostSaleEligible(booking.status, booking.itineraries as Itinerary[], this.clock.now());
    const quote = await this.quotes.find(input.ownerId, booking.id, input.quoteId);
    if (!quote || quote.usedAt || quote.expiresAt <= this.clock.now() || !await this.quotes.consume(input.ownerId, booking.id, input.quoteId, this.clock.now())) throw new DomainError('QUOTE_EXPIRED');
    const value = quote.payload as Quote;
    booking.status = 'CANCEL_PENDING';
    booking.pendingOperation = { kind: 'CANCELLATION', quoteId: value.quoteId, refundAmount: value.refundAmount, currency: value.currency, ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}), step: 'CREATED' } as never;
    booking.changes.push({ changedAt: this.clock.now().toISOString(), description: 'CANCEL_PENDING' });
    await this.reservations.update(booking);
    try {
      await this.settlePayment(booking, value);
      (booking.pendingOperation as { step: string }).step = 'PAYMENT_SETTLED'; await this.reservations.update(booking);
      const tickets = await this.ticketing.listTickets({ bookingId: booking.id, ownerId: input.ownerId });
      if (decimalToMinor(value.refundAmount) > 0 && tickets.some((ticket) => (ticket as { status?: string }).status === 'ISSUED')) {
        if (!this.ticketing.refundTickets) throw new DomainError('TICKET_ISSUANCE_FAILED');
        await this.ticketing.refundTickets({ bookingId: booking.id, ownerId: input.ownerId });
      }
      else await this.ticketing.voidTickets({ bookingId: booking.id, ownerId: input.ownerId });
      (booking.pendingOperation as { step: string }).step = 'TICKETS_SETTLED'; await this.reservations.update(booking);
      await this.inventory.releaseReservedInventory({ bookingId: booking.id, ownerId: input.ownerId });
      (booking.pendingOperation as { step: string }).step = 'INVENTORY_RELEASED'; await this.reservations.update(booking);
      await this.ancillaries.releaseAll({ bookingId: booking.id, ownerId: input.ownerId });
      booking.status = 'CANCELLED'; booking.pendingOperation = undefined;
      booking.changes.push({ changedAt: this.clock.now().toISOString(), description: 'CANCELLED' });
      await this.reservations.update(booking);
      await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.cancelled', bookingId: booking.id, pnr: booking.pnr, status: booking.status, eventId: value.quoteId, refundAmount: value.refundAmount, extra: eventExtra(booking, { reasonCode: input.reasonCode ?? 'CUSTOMER_REQUEST', refundId: refundIdFor(value.quoteId), seatsReleased: seatsOf(booking) }) });
    } catch {
      return booking;
    }
    return booking;
  }

  private async settlePayment(booking: StoredReservation, quote: Quote) {
    const amount = decimalToMinor(quote.refundAmount);
    if (amount > 0) {
      if (!this.payment.refund) throw new DomainError('PAYMENT_NOT_AUTHORIZED');
      await this.payment.refund({ paymentReference: booking.paymentReference, amount: minorToDecimal(amount), currency: quote.currency });
    } else await this.payment.void({ paymentReference: booking.paymentReference });
  }

  private async owned(input: { bookingId: string; ownerId: string }) {
    const booking = await this.reservations.findById(input.ownerId, input.bookingId);
    if (!booking) throw new DomainError('NOT_FOUND');
    return booking;
  }
}
