import { DomainError } from '@flight-platform/shared';
import { allocationOf, deterministicEventId, eventExtra, isV2Reservation, refundIdFor, seatsOf, ticketSummary, translateDependencyError } from './allocation';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from './ports';
import { ReservationStore, StoredReservation } from './reservation-store';

const PENDING_STATUSES = ['PENDING_PAYMENT', 'TICKET_ISSUING', 'CHANGE_PENDING', 'CANCEL_PENDING'];

export class ResumePending {
  constructor(private readonly store: ReservationStore, private readonly payment: PaymentVerifier, private readonly events: EventPublisher, private readonly ancillaries?: AncillariesPort, private readonly inventory?: InventoryPort, private readonly ticketing?: TicketingPort, private readonly pricing?: PricingPort) {}

  async execute(input: { limit?: number }): Promise<{ resumedCount: number }> {
    let resumedCount = 0;
    for (const reservation of await this.store.findPending(input.limit ?? 50)) if (await this.process(reservation)) resumedCount += 1;
    return { resumedCount };
  }

  /** Reintenta una sola reserva del dueño (p. ej. `payment.confirmed` de Booking). Si no está pendiente no hace nada. */
  async resumeOne(input: { bookingId: string; ownerId: string }): Promise<void> {
    const reservation = await this.store.findById(input.ownerId, input.bookingId);
    if (!reservation) throw new DomainError('NOT_FOUND');
    if (PENDING_STATUSES.includes(reservation.status)) await this.process(reservation);
  }

  /** Devuelve true si la reserva avanzó (cuenta en `resumedCount`). */
  private async process(reservation: StoredReservation): Promise<boolean> {
    if (reservation.status === 'CHANGE_PENDING' && reservation.pendingOperation?.kind === 'DATE_CHANGE') return this.resumeDateChange(reservation);
    if (reservation.status === 'CANCEL_PENDING' && reservation.pendingOperation?.kind === 'CANCELLATION') return this.resumeCancellation(reservation);
    if (reservation.status === 'PENDING_PAYMENT') {
      let result;
      try { result = await this.payment.verify({ paymentReference: reservation.paymentReference, currency: reservation.grandTotal.currency, total: reservation.grandTotal.total, ...(reservation.paymentChannel ? { channel: reservation.paymentChannel } : {}) }); }
      catch (error) {
        // Pago rechazado, inexistente o con otro monto: la reserva falla. Cualquier otro error (p. ej. Booking sin responder) se reintenta en el siguiente ciclo.
        if (error instanceof DomainError) { await this.failBeforeIssuance(reservation, error.code); return true; }
        return false;
      }
      if (result === 'PENDING') return false;
      // v2: el pago llegó después de crear la reserva, así que ahora se reservan asientos y equipaje y se consume el hold.
      // El camino de v1 (pago pendiente simulado) conserva su comportamiento de siempre.
      if (isV2Reservation(reservation) && !(await this.allocate(reservation))) return true;
      reservation.status = 'TICKET_ISSUING';
    }
    let confirmed = false; let issued: unknown[] | undefined;
    if (reservation.status === 'TICKET_ISSUING') {
      try {
        issued = await this.ticketing?.issueTickets({ bookingId: reservation.id, ownerId: reservation.ownerId, passengers: reservation.passengers, itineraries: reservation.itineraries, requestId: reservation.id });
        if (issued?.some((ticket) => (ticket as { status?: string }).status !== 'ISSUED')) throw new Error('ticket issuance failed');
        const hasSeats = (reservation.passengers as Array<{ assignedSeats?: unknown[] }>).some((passenger) => (passenger.assignedSeats?.length ?? 0) > 0);
        if (hasSeats) await this.ancillaries?.confirmSeats({ bookingId: reservation.id, ownerId: reservation.ownerId });
        reservation.status = 'CONFIRMED'; confirmed = true;
      } catch {
        reservation.attempts += 1;
        if (reservation.attempts < 3) { reservation.changes.push({ changedAt: new Date().toISOString(), description: 'TICKET_ISSUING' }); await this.store.update(reservation); return true; }
        reservation.status = 'FAILED';
        const anyIssued = (await this.ticketing?.listTickets({ bookingId: reservation.id, ownerId: reservation.ownerId }) ?? []).some((ticket) => (ticket as { status?: string }).status === 'ISSUED');
        await Promise.allSettled([this.payment.void({ paymentReference: reservation.paymentReference }), this.ancillaries?.releaseAll({ bookingId: reservation.id, ownerId: reservation.ownerId }), this.inventory?.releaseReservedInventory({ bookingId: reservation.id, ownerId: reservation.ownerId }), ...(anyIssued ? [this.ticketing!.voidTickets({ bookingId: reservation.id, ownerId: reservation.ownerId })] : [])]);
        if (isV2Reservation(reservation)) await this.events.publish({ ownerId: reservation.ownerId, eventType: 'booking.ticket_failed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, eventId: deterministicEventId(reservation.id, 'booking.ticket_failed'), extra: eventExtra(reservation, { errorCode: 'TICKET_ISSUANCE_FAILED' }) }).catch(() => undefined);
        await this.events.publish({ ownerId: reservation.ownerId, eventType: 'booking.failed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, extra: eventExtra(reservation, { errorCode: 'TICKET_ISSUANCE_FAILED' }) });
      }
    }
    reservation.attempts += 1; reservation.changes.push({ changedAt: new Date().toISOString(), description: reservation.status }); await this.store.update(reservation);
    if (confirmed) {
      await this.events.publish({ ownerId: reservation.ownerId, eventType: 'booking.confirmed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, extra: eventExtra(reservation) });
      if (isV2Reservation(reservation)) await this.events.publish({ ownerId: reservation.ownerId, eventType: 'booking.ticket_issued', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, eventId: deterministicEventId(reservation.id, 'booking.ticket_issued'), extra: eventExtra(reservation, { paymentReference: reservation.paymentReference, tickets: ticketSummary(issued ?? []) }) }).catch(() => undefined);
    }
    return true;
  }

  /** Mismos pasos que la creación inmediata cuando el pago ya estaba aprobado. Devuelve false si falló (la reserva queda FAILED). */
  private async allocate(reservation: StoredReservation): Promise<boolean> {
    if (!this.ancillaries || !this.inventory) return true;
    const { assignments, baggage } = allocationOf(reservation.passengers);
    try {
      if (assignments.length) await this.ancillaries.reserveSeats({ bookingId: reservation.id, ownerId: reservation.ownerId, assignments });
      if (baggage.length) await this.ancillaries.reserveBaggage({ bookingId: reservation.id, ownerId: reservation.ownerId, baggage });
      await this.inventory.consumeHold({ holdId: reservation.holdId, ownerId: reservation.ownerId, reservationId: reservation.id });
      return true;
    } catch (error) { const translated = translateDependencyError(error); await this.failBeforeIssuance(reservation, translated instanceof DomainError ? translated.code : 'OFFER_NO_LONGER_AVAILABLE'); return false; }
  }

  private async failBeforeIssuance(reservation: StoredReservation, errorCode: string): Promise<void> {
    reservation.status = 'FAILED'; reservation.attempts += 1; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'FAILED' }); await this.store.update(reservation);
    await Promise.allSettled([this.payment.void({ paymentReference: reservation.paymentReference }), this.ancillaries?.releaseAll({ bookingId: reservation.id, ownerId: reservation.ownerId }), this.inventory?.releaseReservedInventory({ bookingId: reservation.id, ownerId: reservation.ownerId }), this.pricing?.releaseHold?.({ holdId: reservation.holdId, ownerId: reservation.ownerId })]);
    await this.events.publish({ ownerId: reservation.ownerId, eventType: 'booking.failed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, extra: eventExtra(reservation, { errorCode }) });
  }

  private async resumeDateChange(booking: StoredReservation): Promise<boolean> {
    const operation = booking.pendingOperation!;
    if (operation.kind !== 'DATE_CHANGE' || !this.inventory || !this.ancillaries || !this.ticketing?.reissueTickets) return false;
    try {
      if (operation.step === 'CREATED') { await this.inventory.releaseReservedInventory({ bookingId: booking.id, ownerId: booking.ownerId }); operation.step = 'OLD_INVENTORY_RELEASED'; await this.store.update(booking); }
      if (operation.step === 'OLD_INVENTORY_RELEASED') { await this.inventory.consumeHold({ holdId: booking.holdId, ownerId: booking.ownerId, reservationId: booking.id }); operation.step = 'HOLD_CONSUMED'; await this.store.update(booking); }
      if (operation.step === 'HOLD_CONSUMED') { await this.ancillaries.releaseAll({ bookingId: booking.id, ownerId: booking.ownerId }); operation.step = 'ANCILLARIES_RELEASED'; await this.store.update(booking); }
      if (operation.step === 'ANCILLARIES_RELEASED') { const travelers = booking.passengers as Array<{ passengerId: string; passengerType: string }>; const itinerary = booking.itineraries[0] as { pricingOptions?: Array<{ cabinClass?: string }> }; const seats = operation.assignedSeats as Array<{ segmentId: string; seatNumber: string }>; if (seats.length) await this.ancillaries.reserveSeats({ bookingId: booking.id, ownerId: booking.ownerId, assignments: seats.map((seat, index) => ({ ...seat, passengerId: travelers.filter((p) => p.passengerType !== 'INFANT')[index]?.passengerId, passengerType: travelers.filter((p) => p.passengerType !== 'INFANT')[index]?.passengerType, cabinClass: itinerary.pricingOptions?.[0]?.cabinClass })) }); operation.step = 'SEATS_RESERVED'; await this.store.update(booking); }
      if (operation.step === 'SEATS_RESERVED') { const tickets = await this.ticketing.reissueTickets({ bookingId: booking.id, ownerId: booking.ownerId, newItineraries: booking.itineraries }); const issuedCount = tickets.filter((ticket) => (ticket as { status?: string }).status === 'ISSUED').length; if (issuedCount < (booking.passengers as unknown[]).length) return false; operation.step = 'TICKETS_REISSUED'; await this.store.update(booking); }
      booking.status = 'CONFIRMED'; booking.pendingOperation = undefined; booking.changes.push({ changedAt: new Date().toISOString(), description: 'CONFIRMED' }); await this.store.update(booking); await this.events.publish({ ownerId: booking.ownerId, eventType: 'booking.changed', bookingId: booking.id, pnr: booking.pnr, status: booking.status }); return true;
    } catch { booking.attempts += 1; await this.store.update(booking); return false; }
  }
  private async resumeCancellation(booking: StoredReservation): Promise<boolean> {
    const operation = booking.pendingOperation!;
    if (operation.kind !== 'CANCELLATION' || !this.inventory || !this.ancillaries || !this.ticketing) return false;
    try {
      if (operation.step === 'CREATED') { if (Number(operation.refundAmount) > 0) { if (!this.payment.refund) return false; await this.payment.refund({ paymentReference: booking.paymentReference, amount: operation.refundAmount, currency: operation.currency }); } else await this.payment.void({ paymentReference: booking.paymentReference }); operation.step = 'PAYMENT_SETTLED'; await this.store.update(booking); }
      if (operation.step === 'PAYMENT_SETTLED') { const tickets = await this.ticketing.listTickets({ bookingId: booking.id, ownerId: booking.ownerId }); if (Number(operation.refundAmount) > 0 && tickets.some((ticket) => (ticket as { status?: string }).status === 'ISSUED')) { if (!this.ticketing.refundTickets) return false; await this.ticketing.refundTickets({ bookingId: booking.id, ownerId: booking.ownerId }); } else await this.ticketing.voidTickets({ bookingId: booking.id, ownerId: booking.ownerId }); operation.step = 'TICKETS_SETTLED'; await this.store.update(booking); }
      if (operation.step === 'TICKETS_SETTLED') { await this.inventory.releaseReservedInventory({ bookingId: booking.id, ownerId: booking.ownerId }); operation.step = 'INVENTORY_RELEASED'; await this.store.update(booking); }
      if (operation.step === 'INVENTORY_RELEASED') { await this.ancillaries.releaseAll({ bookingId: booking.id, ownerId: booking.ownerId }); operation.step = 'ANCILLARIES_RELEASED'; await this.store.update(booking); }
      booking.status = 'CANCELLED'; booking.pendingOperation = undefined; booking.changes.push({ changedAt: new Date().toISOString(), description: 'CANCELLED' }); await this.store.update(booking); await this.events.publish({ ownerId: booking.ownerId, eventType: 'booking.cancelled', bookingId: booking.id, pnr: booking.pnr, status: booking.status, eventId: operation.quoteId, refundAmount: operation.refundAmount, extra: eventExtra(booking, { reasonCode: operation.reasonCode ?? 'CUSTOMER_REQUEST', refundId: refundIdFor(operation.quoteId), seatsReleased: seatsOf(booking) }) }); return true;
    } catch { booking.attempts += 1; await this.store.update(booking); return false; }
  }
}
