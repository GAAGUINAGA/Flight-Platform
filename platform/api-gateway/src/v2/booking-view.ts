import { externalId } from './ids';
import { publicItinerary } from './shapes';
import { bookingLinks } from './links';
import type { V2BookingRecord } from './state';

type Json = Record<string, unknown>;
export interface RawBooking { bookingId: string; pnr: string; status: string; grandTotal: Json; createdAt?: string; updatedAt?: string; itineraries?: Json[]; passengers?: Json[]; tickets?: Json[]; changes?: Json[] }

/** El estado interno de cancelación en curso se publica con el nombre del contrato. */
export const v2Status = (status: string): string => status === 'CANCEL_PENDING' ? 'CANCELLATION_PENDING' : status;
export const internalStatus = (status: string): string => status === 'CANCELLATION_PENDING' ? 'CANCEL_PENDING' : status;

const itinerariesOf = (raw: RawBooking): Json[] => (raw.itineraries ?? []).map(publicItinerary);

export function ticketViews(raw: RawBooking, map: Record<string, string>): Json[] {
  const passengers = new Map((raw.passengers ?? []).map((passenger) => [String(passenger.passengerId), passenger]));
  const segments = new Map(itinerariesOf(raw).flatMap((itinerary) => (itinerary.segments as Json[]).map((segment) => [String(segment.segmentId), segment] as const)));
  return (raw.tickets ?? []).map((ticket) => {
    const passenger = passengers.get(String(ticket.passengerId)); const seats = (passenger?.assignedSeats ?? []) as Array<{ segmentId?: string; seatNumber?: string }>;
    const name = passenger ? `${String(passenger.firstName ?? '')} ${String(passenger.lastName ?? '')}`.trim() : '';
    return {
      ...ticket, passengerId: externalId(map, String(ticket.passengerId)), ...(name ? { passengerName: name } : {}),
      segments: ((ticket.segments ?? []) as Json[]).map((segment) => {
        const flight = segments.get(String(segment.segmentId)) as { flightNumber?: string; departure?: { iataCode?: string; at?: string }; arrival?: { iataCode?: string; at?: string } } | undefined;
        const seat = seats.find((item) => item.segmentId === segment.segmentId)?.seatNumber;
        return { ...segment, ...(flight?.flightNumber ? { flightNumber: flight.flightNumber } : {}), ...(flight?.departure?.iataCode ? { departureIataCode: flight.departure.iataCode } : {}), ...(flight?.arrival?.iataCode ? { arrivalIataCode: flight.arrival.iataCode } : {}), ...(flight?.departure?.at ? { departureAt: flight.departure.at } : {}), ...(flight?.arrival?.at ? { arrivalAt: flight.arrival.at } : {}), ...(seat ? { seatNumber: seat } : {}) };
      })
    };
  });
}
export const issuedCount = (raw: RawBooking): number => (raw.tickets ?? []).filter((ticket) => ticket.status === 'ISSUED').length;
const allIssued = (raw: RawBooking): boolean => (raw.tickets ?? []).length > 0 && (raw.tickets ?? []).every((ticket) => ticket.status === 'ISSUED');

/** BookingDetail de v2: la reserva de Reservation más lo que v2 expone y vive en el estado de la fachada, con los ids de pasajero de Booking. */
export function bookingView(raw: RawBooking, record: V2BookingRecord | null, base: string): Json {
  const map = record?.passengerMap ?? {}; const status = v2Status(raw.status);
  return {
    bookingId: raw.bookingId, pnr: raw.pnr, status, grandTotal: raw.grandTotal, createdAt: raw.createdAt, ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
    ...(record ? { holdId: record.holdId, paymentReference: record.paymentReference, ...(record.salesChannel ? { salesChannel: record.salesChannel } : {}) } : {}),
    itineraries: itinerariesOf(raw),
    passengers: (raw.passengers ?? []).map((passenger) => ({ ...passenger, passengerId: externalId(map, String(passenger.passengerId)), ...(passenger.associatedAdultId ? { associatedAdultId: externalId(map, String(passenger.associatedAdultId)) } : {}) })),
    tickets: ticketViews(raw, map), changes: raw.changes ?? [], _links: bookingLinks(base, raw.bookingId, status, allIssued(raw))
  };
}
