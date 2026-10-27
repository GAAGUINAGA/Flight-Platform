import { createHash } from 'node:crypto';
import { StoredReservation } from './reservation-store';

type PassengerData = { passengerId: string; passengerType: string; assignedSeats?: Array<{ segmentId: string; seatNumber: string }>; extraBaggage?: Array<{ itineraryId: string; quantity: number }> };

/** Asientos y equipaje extra que los pasajeros pidieron al reservar; se reservan al aprobarse el pago. */
export function allocationOf(passengers: unknown[]): { assignments: Array<Record<string, unknown>>; baggage: Array<Record<string, unknown>> } {
  const data = passengers as PassengerData[];
  return {
    assignments: data.flatMap((passenger) => (passenger.assignedSeats ?? []).map((seat) => ({ ...seat, passengerId: passenger.passengerId, passengerType: passenger.passengerType, cabinClass: 'ECONOMY' }))),
    baggage: data.flatMap((passenger) => (passenger.extraBaggage ?? []).map((item) => ({ ...item, passengerId: passenger.passengerId })))
  };
}

/** UUID determinista por (reserva, evento): reintentos del mismo hecho no duplican el evento y hechos distintos de una misma reserva no chocan. */
export function deterministicEventId(bookingId: string, eventType: string): string {
  const hex = createHash('sha256').update(`${bookingId}:${eventType}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Una reserva creada por un partner de v2 lleva canal de pago; las de v1 no, y su comportamiento observable no cambia. */
export const isV2Reservation = (reservation: StoredReservation): boolean => Boolean(reservation.paymentChannel);

/** Datos de evento que solo ven las suscripciones v2. Para reservas de v1 es `undefined`: el evento sale exactamente como siempre. */
export const eventExtra = (reservation: StoredReservation, more: Record<string, unknown> = {}): Record<string, unknown> | undefined => isV2Reservation(reservation) ? { grandTotal: reservation.grandTotal, ...more } : undefined;

type TicketLike = { ticketId?: string; eTicketNumber?: string; passengerId?: string };
export const ticketSummary = (tickets: unknown[]): TicketLike[] => (tickets as TicketLike[]).map((ticket) => ({ ticketId: ticket.ticketId, eTicketNumber: ticket.eTicketNumber, passengerId: ticket.passengerId }));
