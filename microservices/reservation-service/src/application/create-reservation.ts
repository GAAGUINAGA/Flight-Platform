import { randomUUID } from 'node:crypto';
import { decimalToMinor, DomainError, minorToDecimal } from '@flight-platform/shared';
import { validatePassengers } from '../domain/passengers';
import { generatePnr } from '../domain/pnr';
import { allocationOf, deterministicEventId, eventExtra, isV2Reservation, ticketSummary } from './allocation';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from './ports';
import { ReservationStore, StoredReservation } from './reservation-store';
export interface CreateReservationInput { ownerId: string; holdId: string; passengers: unknown[]; payment: { paymentReference: string }; idempotencyKey: string; paymentChannel?: string; deferIssuanceFailure?: boolean; }
type CreateReservationResult = StoredReservation & { tickets?: unknown[] };
export class CreateReservation {
  private readonly pending = new Map<string, Promise<CreateReservationResult>>();
  private serial: Promise<void> = Promise.resolve();
  constructor(private readonly store: ReservationStore, private readonly pricing: PricingPort, private readonly payment: PaymentVerifier, private readonly ancillaries: AncillariesPort, private readonly inventory: InventoryPort, private readonly ticketing: TicketingPort, private readonly events: EventPublisher) {}
  async execute(input: CreateReservationInput): Promise<CreateReservationResult> {
    const lock = `${input.ownerId}:${input.idempotencyKey}`; const active = this.pending.get(lock); if (active) return active;
    const operation = this.serial.then(() => this.create(input)); this.serial = operation.then(() => undefined, () => undefined); this.pending.set(lock, operation); try { return await operation; } finally { this.pending.delete(lock); }
  }
  private async create(input: CreateReservationInput): Promise<CreateReservationResult> {
    const existing = await this.store.findByIdempotency(input.ownerId, input.idempotencyKey); if (existing) return existing;
    const used = await this.store.findByPaymentReference(input.payment.paymentReference); if (used) throw new DomainError('PAYMENT_REFERENCE_INVALID');
    const hold = await this.pricing.getHold({ holdId: input.holdId, ownerId: input.ownerId }); if (hold.status !== 'HELD' || new Date(hold.expiresAt) <= new Date()) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
    validatePassengers(input.passengers as never[], hold.passengersBreakdown);
    const itineraryPrices = hold.itineraries as Array<{ itineraryId: string; pricingOptions: Array<{ extraCheckedBaggagePrice?: { currency: string; total: string } }> }>;
    let expectedMinor = decimalToMinor(hold.lockedPrice.total);
    for (const passenger of input.passengers as Array<{ extraBaggage?: Array<{ itineraryId: string; quantity: number }> }>) for (const bag of passenger.extraBaggage ?? []) {
      const itinerary = itineraryPrices.find((item) => item.itineraryId === bag.itineraryId);
      const price = itinerary?.pricingOptions?.[0]?.extraCheckedBaggagePrice;
      if (!price || price.currency !== hold.lockedPrice.currency) throw new DomainError('VALIDATION_FAILED');
      expectedMinor += decimalToMinor(price.total) * bag.quantity;
    }
    if (!Number.isSafeInteger(expectedMinor)) throw new DomainError('VALIDATION_FAILED');
    const grandTotal = { ...hold.lockedPrice, total: minorToDecimal(expectedMinor) };
    const paymentResult = await this.payment.verify({ paymentReference: input.payment.paymentReference, currency: grandTotal.currency, total: grandTotal.total, ...(input.paymentChannel ? { channel: input.paymentChannel } : {}) });
    const reservation: StoredReservation = { id: randomUUID(), ownerId: input.ownerId, pnr: await generatePnr(async (pnr) => Boolean(await this.store.findByPnr(pnr))), status: paymentResult === 'PENDING' ? 'PENDING_PAYMENT' : 'PENDING', holdId: input.holdId, paymentReference: input.payment.paymentReference, idempotencyKey: input.idempotencyKey, passengers: input.passengers, itineraries: hold.itineraries, grandTotal, changes: [], attempts: 0, ...(input.paymentChannel ? { paymentChannel: input.paymentChannel } : {}) };
    if (hold.itineraries.length === 0) throw new DomainError('VALIDATION_FAILED');
    const allowanceItems = (hold.itineraries as Array<{ itineraryId: string; pricingOptions: Array<{ baggageAllowance?: { checkedBaggageIncluded?: number } }> }>).flatMap((itinerary) => {
      const included = itinerary.pricingOptions?.[0]?.baggageAllowance?.checkedBaggageIncluded;
      if (!Number.isInteger(included) || included! < 0) throw new DomainError('VALIDATION_FAILED');
      return (input.passengers as Array<{ passengerId: string; passengerType: string }>).map((passenger) => ({ passengerId: passenger.passengerId, itineraryId: itinerary.itineraryId, checkedBaggageIncluded: passenger.passengerType === 'INFANT' ? 0 : included! }));
    });
    await this.store.create(reservation);
    try { await this.ancillaries.registerBaggageAllowance({ bookingId: reservation.id, ownerId: input.ownerId, allowances: allowanceItems }); }
    catch (error) { reservation.status = 'FAILED'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'FAILED' }); await this.store.update(reservation); await this.payment.void({ paymentReference: input.payment.paymentReference }); throw error; }
    if (paymentResult === 'PENDING') return reservation;
    const { assignments, baggage } = allocationOf(input.passengers);
    try { if (assignments.length) await this.ancillaries.reserveSeats({ bookingId: reservation.id, ownerId: input.ownerId, assignments }); if (baggage.length) await this.ancillaries.reserveBaggage({ bookingId: reservation.id, ownerId: input.ownerId, baggage }); await this.inventory.consumeHold({ holdId: input.holdId, ownerId: input.ownerId, reservationId: reservation.id }); } catch (error) { reservation.status = 'FAILED'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'FAILED' }); await this.store.update(reservation); await this.ancillaries.releaseAll({ bookingId: reservation.id, ownerId: input.ownerId }); await this.payment.void({ paymentReference: input.payment.paymentReference }); await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.failed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, extra: eventExtra(reservation, { errorCode: error instanceof DomainError ? error.code : 'PNR_CREATION_FAILED' }) }); throw error; } reservation.status = 'TICKET_ISSUING'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'TICKET_ISSUING' }); await this.store.update(reservation);
    let tickets: unknown[];
    try {
      tickets = await this.ticketing.issueTickets({ bookingId: reservation.id, ownerId: input.ownerId, passengers: input.passengers, itineraries: hold.itineraries, requestId: reservation.id });
      if (tickets.some((ticket) => (ticket as { status?: string }).status !== 'ISSUED')) throw new DomainError('TICKET_ISSUANCE_FAILED');
    } catch (error) {
      // La reserva ya consumió el hold y queda en TICKET_ISSUING: ResumePending reintenta. Con `deferIssuanceFailure` (v2) se devuelve así, para responder 202.
      if (input.deferIssuanceFailure) return reservation;
      throw error;
    }
    reservation.status = 'CONFIRMED'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'CONFIRMED' }); await this.store.update(reservation); if (assignments.length) await this.ancillaries.confirmSeats({ bookingId: reservation.id, ownerId: input.ownerId });
    await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.confirmed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, extra: eventExtra(reservation) });
    // Evento adicional solo de v2: si falla no deshace una reserva ya confirmada (el feed y el reintento de Booking lo cubren).
    if (isV2Reservation(reservation)) await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.ticket_issued', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, eventId: deterministicEventId(reservation.id, 'booking.ticket_issued'), extra: eventExtra(reservation, { paymentReference: reservation.paymentReference, tickets: ticketSummary(tickets) }) }).catch(() => undefined);
    return { ...reservation, tickets };
  }
}
