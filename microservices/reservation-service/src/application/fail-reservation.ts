import { DomainError } from '@flight-platform/shared';
import { deterministicEventId, eventExtra } from './allocation';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from './ports';
import { ReservationStore, StoredReservation } from './reservation-store';

/**
 * `payment.failed` de Booking (decisión D3): la reserva termina FAILED aunque ya tenga boletos.
 * Anula los boletos, libera asientos y capacidad y, si el hold seguía vivo, lo libera. Sin reembolso.
 * Idempotente: una reserva ya FAILED o CANCELLED se devuelve tal cual. Si un paso falla no se cambia el estado,
 * de modo que el reintento de Booking repite la compensación completa.
 */
export class FailReservation {
  constructor(private readonly store: ReservationStore, private readonly payment: PaymentVerifier, private readonly events: EventPublisher, private readonly ancillaries: AncillariesPort, private readonly inventory: InventoryPort, private readonly ticketing: TicketingPort, private readonly pricing?: PricingPort) {}

  async execute(input: { bookingId: string; ownerId: string; reason?: string }): Promise<StoredReservation> {
    const reservation = await this.store.findById(input.ownerId, input.bookingId);
    if (!reservation) throw new DomainError('NOT_FOUND');
    if (reservation.status === 'FAILED' || reservation.status === 'CANCELLED') return reservation;
    // Con un cambio de fecha o una cancelación en curso el pago original ya no es lo único en juego: no se pisa.
    if (reservation.status === 'CHANGE_PENDING' || reservation.status === 'CANCEL_PENDING') throw new DomainError('BOOKING_NOT_CONFIRMED');
    const ref = { bookingId: reservation.id, ownerId: reservation.ownerId };
    const tickets = await this.ticketing.listTickets(ref);
    if (tickets.some((ticket) => (ticket as { status?: string }).status === 'ISSUED')) await this.ticketing.voidTickets(ref);
    await this.ancillaries.releaseAll(ref);
    await this.inventory.releaseReservedInventory(ref);
    await this.pricing?.releaseHold?.({ holdId: reservation.holdId, ownerId: reservation.ownerId }).catch(() => undefined);
    await this.payment.void({ paymentReference: reservation.paymentReference });
    reservation.status = 'FAILED'; reservation.attempts += 1; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'FAILED' });
    await this.store.update(reservation);
    await this.events.publish({ ownerId: reservation.ownerId, eventType: 'booking.failed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, eventId: deterministicEventId(reservation.id, 'booking.failed:payment'), extra: eventExtra(reservation, { errorCode: 'PAYMENT_FAILED', ...(input.reason ? { failureReason: input.reason } : {}) }) });
    return reservation;
  }
}
