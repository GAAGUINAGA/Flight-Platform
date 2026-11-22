import { randomUUID } from 'node:crypto';
import { Clock, decimalToMinor, DomainError, minorToDecimal } from '@flight-platform/shared';
import { assertPostSaleEligible, PostSaleItinerary } from '../domain/post-sale-eligibility';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from './ports';
import { ReservationStore, StoredReservation } from './reservation-store';
import { cabinBySegment, eventExtra } from './allocation';
import { compensate } from './compensation';

/** Cabina comprada por segmento para el cambio de fecha: entre las opciones del itinerario, las que permiten cambios. Compartida con ResumePending. */
export const changeableCabinBySegment = (itineraries: unknown[]): ((segmentId: string) => string) => cabinBySegment(itineraries, (option) => option.fareRules?.isChangeable === true);

type Segment = { flightInstanceId?: string; segmentId: string; departure: { at: string; iataCode?: string }; arrival?: { iataCode?: string }; [key: string]: unknown };
type Itinerary = { itineraryId: string; segments: Segment[]; pricingOptions: Array<{ cabinClass?: string; fareRules?: { isChangeable?: boolean }; [key: string]: unknown }> } & PostSaleItinerary;
type Offer = { changeOfferId: string; expiresAt: string; segments: Segment[]; priceDifference: { totalToPay: string } };
type Input = { bookingId: string; ownerId: string; changeOfferId: string; payment?: { paymentReference: string }; assignedSeats: unknown[]; idempotencyKey: string; paymentChannel?: string };

export class ConfirmDateChange {
  private readonly active = new Map<string, Promise<StoredReservation>>();
  private readonly activeOffers = new Set<string>();
  constructor(private readonly reservations: ReservationStore, private readonly pricing: PricingPort, private readonly payment: PaymentVerifier, private readonly inventory: InventoryPort, private readonly ancillaries: AncillariesPort, private readonly ticketing: TicketingPort, private readonly events: EventPublisher, private readonly clock: Clock, private readonly holdTtlMinutes: number) {}

  execute(input: Input): Promise<StoredReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const active = this.active.get(key);
    if (active) return active;
    const offerKey = `${input.ownerId}:${input.changeOfferId}`;
    if (this.activeOffers.has(offerKey)) return Promise.reject(new DomainError('CHANGE_OFFER_EXPIRED'));
    this.activeOffers.add(offerKey);
    const operation = this.confirm(input);
    this.active.set(key, operation);
    void operation.finally(() => { this.active.delete(key); this.activeOffers.delete(offerKey); }).catch(() => undefined);
    return operation;
  }

  private async confirm(input: Input): Promise<StoredReservation> {
    const booking = await this.reservations.findById(input.ownerId, input.bookingId);
    if (!booking) throw new DomainError('NOT_FOUND');
    const oldItineraries = booking.itineraries as Itinerary[];
    assertPostSaleEligible(booking.status, oldItineraries, this.clock.now());
    if (oldItineraries.some((itinerary) => !Array.isArray(itinerary.pricingOptions) || !itinerary.pricingOptions.some((option) => option.fareRules?.isChangeable))) throw new DomainError('FARE_NOT_CHANGEABLE');
    if (!this.pricing.getChangeOffer || !this.pricing.markChangeOfferUsed || !this.inventory.createHold || !this.ticketing.reissueTickets) throw new DomainError('VALIDATION_FAILED');
    const offer = await this.pricing.getChangeOffer({ changeOfferId: input.changeOfferId, ownerId: input.ownerId }) as Offer;
    if (offer.changeOfferId !== input.changeOfferId || !Number.isFinite(Date.parse(offer.expiresAt)) || Date.parse(offer.expiresAt) <= this.clock.now().getTime()) throw new DomainError('CHANGE_OFFER_EXPIRED');
    const amountMinor = decimalToMinor(offer.priceDifference.totalToPay);
    if (amountMinor < 0) throw new DomainError('VALIDATION_FAILED');
    // REGLA 1 (ADR-fixCompra-01): TODAS las validaciones que pueden rechazar el pedido van antes del primer efecto (reclamar o verificar el pago,
    // marcar la oferta, crear el hold, tocar la reserva o los asientos).
    const paymentReference = input.payment?.paymentReference;
    if (amountMinor > 0 && !paymentReference) throw new DomainError('PAYMENT_REFERENCE_INVALID');
    if (offer.segments.length === 0) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
    const changedItineraries = this.replaceSegments(oldItineraries, offer.segments);
    // La cabina de cada segmento (del hold y de cada asiento) es la comprada en SU itinerario, no la del primero (cabinOfSegment, REGLA 2).
    const cabinOf = changeableCabinBySegment(changedItineraries);
    const holdSegments = offer.segments.map((segment) => ({ flightInstanceId: segment.flightInstanceId ?? segment.segmentId, cabinClass: cabinOf(segment.segmentId) }));
    const travelers = (booking.passengers as Array<{ passengerId: string; passengerType: string }>).filter((passenger) => passenger.passengerType !== 'INFANT');
    // Cada asiento debe pertenecer a un tramo de la reserva (cabinOf lo rechaza si no) y a un pasajero que ocupa asiento.
    const assignments = (input.assignedSeats as Array<{ segmentId: string; seatNumber: string }>).map((seat, index) => ({ ...seat, passengerId: travelers[index]?.passengerId, passengerType: travelers[index]?.passengerType, cabinClass: cabinOf(seat.segmentId) }));
    if (assignments.some((assignment) => !assignment.passengerId)) throw new DomainError('VALIDATION_FAILED');
    const previousHoldId = booking.holdId;
    const seats = travelers.length;
    // Efectos. Hasta que la reserva queda persistida como CHANGE_PENDING, cualquier fallo deshace lo ya hecho y devuelve el error ORIGINAL.
    const before = { status: booking.status, holdId: booking.holdId, itineraries: booking.itineraries, grandTotal: booking.grandTotal, pendingOperation: booking.pendingOperation, changes: [...booking.changes] };
    let claimed = false; let authorized = false; let newHoldId: string | undefined;
    let hold: { holdId: string };
    try {
      if (amountMinor > 0) {
        await this.reservations.claimPaymentReference(paymentReference!, booking.id); claimed = true;
        const result = await this.payment.verify({ paymentReference: paymentReference!, currency: booking.grandTotal.currency, total: minorToDecimal(amountMinor), ...(input.paymentChannel ? { channel: input.paymentChannel } : {}) });
        if (result !== 'AUTHORIZED') throw new DomainError('PAYMENT_NOT_AUTHORIZED');
        authorized = true;
      }
      await this.pricing.markChangeOfferUsed({ changeOfferId: input.changeOfferId, ownerId: input.ownerId });
      hold = await this.inventory.createHold({ ownerId: input.ownerId, segments: holdSegments.map((segment) => ({ ...segment, seats })), expiresAt: new Date(this.clock.now().getTime() + this.holdTtlMinutes * 60_000).toISOString(), idempotencyKey: input.idempotencyKey });
      newHoldId = hold.holdId;
      booking.status = 'CHANGE_PENDING';
      booking.holdId = hold.holdId;
      booking.itineraries = changedItineraries;
      booking.grandTotal = { ...booking.grandTotal, total: minorToDecimal(decimalToMinor(booking.grandTotal.total) + amountMinor) };
      booking.pendingOperation = { kind: 'DATE_CHANGE', previousHoldId, changeOfferId: input.changeOfferId, assignedSeats: input.assignedSeats, step: 'CREATED' };
      booking.changes.push({ changedAt: this.clock.now().toISOString(), description: 'CHANGE_PENDING' });
      await this.reservations.update(booking);
    } catch (error) {
      Object.assign(booking, before);
      if (authorized) await compensate('ConfirmDateChange', 'payment.void', () => this.payment.void({ paymentReference: paymentReference! }));
      if (claimed) await compensate('ConfirmDateChange', 'reservations.releasePaymentReference', () => this.reservations.releasePaymentReference(paymentReference!, booking.id));
      if (newHoldId) await compensate('ConfirmDateChange', 'inventory.releaseHold', async () => { await this.inventory.releaseHold?.({ holdId: newHoldId!, ownerId: input.ownerId }); });
      throw error;
    }
    // Desde aquí la reserva es CHANGE_PENDING y el cambio es reanudable (ResumePending): el inventario anterior ya se libera paso a paso y no se deshace.
    try {
      // Release by reservationId must happen before attaching the new hold to that
      // reservation; otherwise the broad release also frees the newly consumed hold.
      await this.inventory.releaseReservedInventory({ bookingId: booking.id, ownerId: input.ownerId });
      booking.pendingOperation.step = 'OLD_INVENTORY_RELEASED'; await this.reservations.update(booking);
      await this.inventory.consumeHold({ holdId: hold.holdId, ownerId: input.ownerId, reservationId: booking.id });
      booking.pendingOperation.step = 'HOLD_CONSUMED'; await this.reservations.update(booking);
      await this.ancillaries.releaseAll({ bookingId: booking.id, ownerId: input.ownerId });
      booking.pendingOperation.step = 'ANCILLARIES_RELEASED'; await this.reservations.update(booking);
      if (assignments.length) await this.ancillaries.reserveSeats({ bookingId: booking.id, ownerId: input.ownerId, assignments });
      booking.pendingOperation.step = 'SEATS_RESERVED'; await this.reservations.update(booking);
      const tickets = await this.ticketing.reissueTickets({ bookingId: booking.id, ownerId: input.ownerId, newItineraries: changedItineraries });
      const issuedCount = tickets.filter((ticket) => (ticket as { status?: string }).status === 'ISSUED').length;
      if (issuedCount < (booking.passengers as unknown[]).length) throw new DomainError('TICKET_ISSUANCE_FAILED');
      booking.status = 'CONFIRMED';
      booking.pendingOperation = undefined;
      booking.changes.push({ changedAt: this.clock.now().toISOString(), description: 'CONFIRMED' });
      await this.reservations.update(booking);
      await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.changed', bookingId: booking.id, pnr: booking.pnr, status: booking.status, eventId: randomUUID(), extra: eventExtra(booking, { changeType: 'DATE_CHANGE', amountCharged: { currency: booking.grandTotal.currency, total: minorToDecimal(amountMinor) }, paymentReference: input.payment?.paymentReference ?? null }) });
    } catch (error) {
      // Persist a safe failure category for ResumePending; dependency messages never cross gRPC.
      if (booking.pendingOperation?.kind === 'DATE_CHANGE') booking.pendingOperation.lastFailureCode = error instanceof DomainError ? error.code : 'DEPENDENCY_ERROR';
      await this.reservations.update(booking);
      return booking;
    }
    return booking;
  }

  private replaceSegments(itineraries: Itinerary[], replacements: Segment[]): Itinerary[] {
    if (replacements.length === 0) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
    const first = replacements[0].departure?.iataCode;
    const last = replacements.at(-1)?.arrival?.iataCode;
    const target = itineraries.findIndex((itinerary) => itinerary.segments[0]?.departure?.iataCode === first && itinerary.segments.at(-1)?.arrival?.iataCode === last);
    if (target < 0) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
    return itineraries.map((itinerary, index) => index === target ? { ...itinerary, segments: replacements } : itinerary);
  }
}
