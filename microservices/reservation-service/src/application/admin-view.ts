import { createHash } from 'node:crypto';
import { flightLocalDay, flightLocalTime } from '@flight-platform/shared';

/**
 * Vista de solo lectura de una reserva para el administrador (F12c-4a, ADR-F12c4-01).
 * Es una LISTA BLANCA: se construye campo por campo y nunca copia el objeto de origen, así que un campo nuevo en la reserva
 * (documento, correo, teléfono, referencia de pago, dueño…) no puede filtrarse por accidente.
 */
type Json = Record<string, unknown>;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const list = (value: unknown): Json[] => Array.isArray(value) ? value.filter((item): item is Json => typeof item === 'object' && item !== null) : [];

/** Separador del dueño compuesto de un socio: `<clientId>~<usuario final>` (el cliente es la parte previa). */
const OWNER_SEPARATOR = '~';
export const partnerRef = (ownerId: string): string => createHash('sha256').update(ownerId.split(OWNER_SEPARATOR, 1)[0]).digest('hex').slice(0, 12);

const local = (instant: string, iata: string, operation: string): string => instant && iata ? `${flightLocalDay(instant, iata, operation)}T${flightLocalTime(instant, iata, operation)}` : '';

export function adminBookingView(stored: { ownerId: string; paymentChannel?: string }, detail: Json): Json {
  const web = stored.paymentChannel === 'WEB';
  const segments = list(detail.itineraries).flatMap((itinerary) => {
    const cabinClass = text(list(itinerary.pricingOptions)[0]?.cabinClass) || undefined;
    return list(itinerary.segments).map((segment) => {
      const departure = (segment.departure ?? {}) as Json; const arrival = (segment.arrival ?? {}) as Json;
      const status = text(segment.status);
      return {
        segmentId: text(segment.segmentId), flightNumber: text(segment.flightNumber),
        origin: text(departure.iataCode), destination: text(arrival.iataCode),
        departureAt: text(departure.at), arrivalAt: text(arrival.at),
        departureLocal: local(text(departure.at), text(departure.iataCode), 'adminBooking'), arrivalLocal: local(text(arrival.at), text(arrival.iataCode), 'adminBooking'),
        ...(status ? { status } : {}), ...(cabinClass ? { cabinClass } : {})
      };
    });
  });
  const passengers = list(detail.passengers).map((passenger) => ({
    passengerId: text(passenger.passengerId), passengerType: text(passenger.passengerType),
    firstName: text(passenger.firstName), lastName: text(passenger.lastName),
    seats: list(passenger.assignedSeats).map((seat) => ({ segmentId: text(seat.segmentId), seatNumber: text(seat.seatNumber), ...(text(seat.status) ? { status: text(seat.status) } : {}) })),
    extraBaggage: list(passenger.extraBaggage).map((entry) => ({ itineraryId: text(entry.itineraryId), quantity: Number(entry.quantity ?? 0) }))
  }));
  const tickets = list(detail.tickets).map((ticket) => {
    const number = text(ticket.eTicketNumber);
    return { passengerId: text(ticket.passengerId), status: text(ticket.status), ...(number ? { eTicketLast4: number.slice(-4) } : {}), segments: list(ticket.segments).map((segment) => ({ segmentId: text(segment.segmentId), status: text(segment.status) })) };
  });
  const total = (detail.grandTotal ?? {}) as Json;
  return {
    bookingId: text(detail.bookingId), pnr: text(detail.pnr), status: text(detail.status),
    channel: web ? 'WEB' : 'PARTNER', ...(web ? {} : { partnerRef: partnerRef(stored.ownerId) }),
    createdAt: text(detail.createdAt), grandTotal: { currency: text(total.currency), total: text(total.total) },
    segments, passengers, tickets
  };
}
