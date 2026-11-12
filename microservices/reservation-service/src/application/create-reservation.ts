import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { decimalToMinor, DomainError, minorToDecimal } from '@flight-platform/shared';
import { validatePassengers } from '../domain/passengers';
import { generatePnr } from '../domain/pnr';
import { allocationOf, deterministicEventId, eventExtra, isV2Reservation, ticketSummary, withHeldSeats } from './allocation';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from './ports';
import { ReservationStore, StoredReservation } from './reservation-store';
export interface CreateReservationInput { ownerId: string; holdId: string; passengers: unknown[]; payment: { paymentReference: string }; idempotencyKey: string; paymentChannel?: string; deferIssuanceFailure?: boolean; webMaxActiveBookings?: number; webMaxPassengersPerDay?: number; }
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
/** Canal WEB sin topes completos y validos = configuracion faltante: se rechaza (INVALID_ARGUMENT) sin insertar ni tocar el pago. BOOKING no lleva topes. Sin datos personales en el registro. */
function webLimitsOf(input: CreateReservationInput): { maxActiveBookings: number; maxPassengersPerDay: number } | undefined {
  if (input.paymentChannel !== 'WEB') return undefined;
  if (!isPositiveInteger(input.webMaxActiveBookings) || !isPositiveInteger(input.webMaxPassengersPerDay)) {
    new Logger('CreateReservation').error('Configuración faltante: el canal WEB llegó sin topes válidos (webMaxActiveBookings/webMaxPassengersPerDay); creación rechazada antes de insertar.');
    throw new DomainError('VALIDATION_FAILED');
  }
  return { maxActiveBookings: input.webMaxActiveBookings, maxPassengersPerDay: input.webMaxPassengersPerDay };
}
type CreateReservationResult =StoredReservation & { tickets?: unknown[] };
export class CreateReservation {
  private readonly pending = new Map<string, Promise<CreateReservationResult>>();
  private serial: Promise<void> = Promise.resolve();
  constructor(private readonly store: ReservationStore, private readonly pricing: PricingPort, private readonly payment: PaymentVerifier, private readonly ancillaries: AncillariesPort, private readonly inventory: InventoryPort, private readonly ticketing: TicketingPort, private readonly events: EventPublisher) {}
  async execute(input: CreateReservationInput): Promise<CreateReservationResult> {
    const lock = `${input.ownerId}:${input.idempotencyKey}`; const active = this.pending.get(lock); if (active) return active;
    const operation = this.serial.then(() => this.create(input)); this.serial = operation.then(() => undefined, () => undefined); this.pending.set(lock, operation); try { return await operation; } finally { this.pending.delete(lock); }
  }
  private async create(input: CreateReservationInput): Promise<CreateReservationResult> {
    const limits = webLimitsOf(input); // Falla cerrado (ADR-F12c-03): antes de cualquier lectura, insercion o efecto (pago incluido).
    const existing = await this.store.findByIdempotency(input.ownerId, input.idempotencyKey); if (existing) return existing;
    const used = await this.store.findByPaymentReference(input.payment.paymentReference); if (used) throw new DomainError('PAYMENT_REFERENCE_INVALID');
    const hold = await this.pricing.getHold({ holdId: input.holdId, ownerId: input.ownerId }); if (hold.status !== 'HELD' || new Date(hold.expiresAt) <= new Date()) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
    validatePassengers(input.passengers as never[], hold.passengersBreakdown);
    // Asientos apartados en el hold (ADR-F12b2fix-01): sin asientos en la reserva se usan los del hold, en el orden de los pasajeros.
    const held = await this.ancillaries.getHeldSeats?.({ holdId: input.holdId, ownerId: input.ownerId }) ?? [];
    const passengers = withHeldSeats(input.passengers, held);
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
    const reservation: StoredReservation = { id: randomUUID(), ownerId: input.ownerId, pnr: await generatePnr(async (pnr) => Boolean(await this.store.findByPnr(pnr))), status: paymentResult === 'PENDING' ? 'PENDING_PAYMENT' : 'PENDING', holdId: input.holdId, paymentReference: input.payment.paymentReference, idempotencyKey: input.idempotencyKey, passengers, itineraries: hold.itineraries, grandTotal, changes: [], attempts: 0, ...(input.paymentChannel ? { paymentChannel: input.paymentChannel } : {}) };
    if (hold.itineraries.length === 0) throw new DomainError('VALIDATION_FAILED');
    const allowanceItems = (hold.itineraries as Array<{ itineraryId: string; pricingOptions: Array<{ baggageAllowance?: { checkedBaggageIncluded?: number } }> }>).flatMap((itinerary) => {
      const included = itinerary.pricingOptions?.[0]?.baggageAllowance?.checkedBaggageIncluded;
      if (!Number.isInteger(included) || included! < 0) throw new DomainError('VALIDATION_FAILED');
      return (input.passengers as Array<{ passengerId: string; passengerType: string }>).map((passenger) => ({ passengerId: passenger.passengerId, itineraryId: itinerary.itineraryId, checkedBaggageIncluded: passenger.passengerType === 'INFANT' ? 0 : included! }));
    });
    // Canal WEB (ADR-F12c-03): los topes por dueño los aplica el almacén dentro de la transacción que inserta; los socios (BOOKING) no tienen topes.
    try { await this.store.create(reservation, limits); }
    catch (error) { if (error instanceof DomainError && (error.code === 'WEB_ACTIVE_LIMIT_EXCEEDED' || error.code === 'WEB_PASSENGERS_LIMIT_EXCEEDED')) await this.payment.void({ paymentReference: input.payment.paymentReference }).catch(() => undefined); throw error; }
    try { await this.ancillaries.registerBaggageAllowance({ bookingId: reservation.id, ownerId: input.ownerId, allowances: allowanceItems }); }
    catch (error) { reservation.status = 'FAILED'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'FAILED' }); await this.store.update(reservation); await this.payment.void({ paymentReference: input.payment.paymentReference }); throw error; }
    if (paymentResult === 'PENDING') return reservation;
    const { assignments, baggage } = allocationOf(passengers);
    try { if (assignments.length || held.length) await this.ancillaries.reserveSeats({ bookingId: reservation.id, ownerId: input.ownerId, assignments, ...(held.length ? { holdId: input.holdId } : {}) }); if (baggage.length) await this.ancillaries.reserveBaggage({ bookingId: reservation.id, ownerId: input.ownerId, baggage }); await this.inventory.consumeHold({ holdId: input.holdId, ownerId: input.ownerId, reservationId: reservation.id }); } catch (error) { reservation.status = 'FAILED'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'FAILED' }); await this.store.update(reservation); await this.ancillaries.releaseAll({ bookingId: reservation.id, ownerId: input.ownerId, ...(held.length ? { restoreHold: true } : {}) }); await this.payment.void({ paymentReference: input.payment.paymentReference }); await this.events.publish({ ownerId: input.ownerId, eventType: 'booking.failed', bookingId: reservation.id, pnr: reservation.pnr, status: reservation.status, extra: eventExtra(reservation, { errorCode: error instanceof DomainError ? error.code : 'PNR_CREATION_FAILED' }) }); throw error; } reservation.status = 'TICKET_ISSUING'; reservation.changes.push({ changedAt: new Date().toISOString(), description: 'TICKET_ISSUING' }); await this.store.update(reservation);
    let tickets: unknown[];
    try {
      tickets = await this.ticketing.issueTickets({ bookingId: reservation.id, ownerId: input.ownerId, passengers, itineraries: hold.itineraries, requestId: reservation.id });
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
