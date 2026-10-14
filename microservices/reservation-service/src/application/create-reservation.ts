import { randomUUID } from 'node:crypto';
import { DomainError } from '@flight-platform/shared';
import { validatePassengers } from '../domain/passengers';
import { generatePnr } from '../domain/pnr';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from './ports';
import { ReservationStore, StoredReservation } from './reservation-store';
export interface CreateReservationInput { ownerId: string; holdId: string; passengers: unknown[]; payment: { paymentReference: string }; idempotencyKey: string; }
export class CreateReservation {
  private readonly pending = new Map<string, Promise<StoredReservation>>();
  private serial: Promise<void> = Promise.resolve();
  constructor(private readonly store: ReservationStore, private readonly pricing: PricingPort, private readonly payment: PaymentVerifier, private readonly ancillaries: AncillariesPort, private readonly inventory: InventoryPort, private readonly ticketing: TicketingPort, private readonly events: EventPublisher) {}
  async execute(input: CreateReservationInput): Promise<StoredReservation> {
    const lock = `${input.ownerId}:${input.idempotencyKey}`; const active = this.pending.get(lock); if (active) return active;
    const operation = this.serial.then(() => this.create(input)); this.serial = operation.then(() => undefined, () => undefined); this.pending.set(lock, operation); try { return await operation; } finally { this.pending.delete(lock); }
  }
  private async create(input: CreateReservationInput): Promise<StoredReservation> {
    const existing = await this.store.findByIdempotency(input.ownerId, input.idempotencyKey); if (existing) return existing;
    const used = await this.store.findByPaymentReference(input.payment.paymentReference); if (used) throw new DomainError('PAYMENT_REFERENCE_INVALID');
    const hold = await this.pricing.getHold({ holdId: input.holdId, ownerId: input.ownerId }); if (hold.status !== 'HELD' || new Date(hold.expiresAt) <= new Date()) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
    validatePassengers(input.passengers as never[], hold.passengersBreakdown);
    const paymentResult = await this.payment.verify({ paymentReference: input.payment.paymentReference, currency: hold.lockedPrice.currency, total: hold.lockedPrice.total });
    const reservation: StoredReservation = { id: randomUUID(), ownerId: input.ownerId, pnr: await generatePnr(async (pnr) => Boolean(await this.store.findByPnr(pnr))), status: paymentResult === 'PENDING' ? 'PENDING_PAYMENT' : 'PENDING', holdId: input.holdId, paymentReference: input.payment.paymentReference, idempotencyKey: input.idempotencyKey, passengers: input.passengers, itineraries: hold.itineraries, grandTotal: hold.lockedPrice, changes: [], attempts: 0 };
    await this.store.create(reservation); if (paymentResult === 'PENDING') return reservation;
    const passengerData = input.passengers as Array<{ passengerId: string; passengerType: string; assignedSeats?: Array<{ segmentId: string; seatNumber: string }>; extraBaggage?: Array<{ itineraryId: string; quantity: number }> }>;
    const assignments = passengerData.flatMap((passenger) => (passenger.assignedSeats ?? []).map((seat) => ({ ...seat, passengerId: passenger.passengerId, passengerType: passenger.passengerType, cabinClass: 'ECONOMY' })));
    const baggage = passengerData.flatMap((passenger) => (passenger.extraBaggage ?? []).map((item) => ({ ...item, passengerId: passenger.passengerId })));
    try { if (assignments.length) await this.ancillaries.reserveSeats({ bookingId: reservation.id, ownerId: input.ownerId, assignments }); if (baggage.length) await this.ancillaries.reserveBaggage({ bookingId: reservation.id, ownerId: input.ownerId, baggage }); await this.inventory.consumeHold({ holdId: input.holdId, ownerId: input.ownerId, reservationId: reservation.id }); } catch (error) { reservation.status = 'FAILED'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'FAILED' }); await this.store.update(reservation); await this.ancillaries.releaseAll({ bookingId: reservation.id, ownerId: input.ownerId }); await this.payment.void({ paymentReference: input.payment.paymentReference }); await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.failed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status }); throw error; } reservation.status = 'TICKET_ISSUING'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'TICKET_ISSUING' }); await this.store.update(reservation);
    const tickets = await this.ticketing.issueTickets({ bookingId: reservation.id, ownerId: input.ownerId, passengers: input.passengers, itineraries: hold.itineraries, requestId: reservation.id }); if (tickets.some((ticket) => (ticket as { status?: string }).status !== 'ISSUED')) throw new DomainError('TICKET_ISSUANCE_FAILED'); reservation.status = 'CONFIRMED'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'CONFIRMED' }); await this.store.update(reservation); if (assignments.length) await this.ancillaries.confirmSeats({ bookingId: reservation.id, ownerId: input.ownerId }); await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.confirmed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status }); return reservation;
  }
}
