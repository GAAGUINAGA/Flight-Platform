import { createHash } from 'node:crypto';
import { DomainError, ERROR_CODES, type ErrorCode } from '@flight-platform/shared';
import { StoredReservation } from './reservation-store';

type PassengerData = { passengerId: string; passengerType: string; assignedSeats?: Array<{ segmentId: string; seatNumber: string }>; extraBaggage?: Array<{ itineraryId: string; quantity: number }> };

type ItineraryLike = { segments?: Array<{ segmentId?: string }>; pricingOptions?: Array<{ cabinClass?: string; fareRules?: { isChangeable?: boolean } }> };

/**
 * UNA sola regla para saber en qué cabina está un segmento (ADR-fixCompra-01): la cabina de la tarifa COMPRADA del itinerario al que pertenece ese
 * segmento. La usan crear la reserva, reanudar pendientes y el cambio de fecha (donde `itineraries` son los de la oferta de cambio ya aplicada).
 * Nunca hay valor por omisión ni se toma el primer itinerario: si el segmento no está en ningún itinerario, o su itinerario no tiene UNA cabina
 * determinable, es un error de negocio (OFFER_NO_LONGER_AVAILABLE) y no se reserva nada con una cabina inventada.
 * REGLA 2 (ADR-fixCompra-01): la preferencia es un FILTRO. Cuando se pasa `prefer`, SOLO cuentan las tarifas que la cumplen; si ninguna la cumple, o las que
 * la cumplen no tienen cabina o tienen cabinas distintas entre sí, se rechaza: nunca se cae a las tarifas que no la cumplen. Sin `prefer`, una cabina
 * única entre las tarifas del itinerario; si no, rechazo.
 */
export function cabinOfSegment(itineraries: unknown[], segmentId: string, prefer?: (option: { fareRules?: { isChangeable?: boolean } }) => boolean): string {
  const itinerary = (itineraries as ItineraryLike[]).find((candidate) => (candidate.segments ?? []).some((segment) => segment.segmentId === segmentId));
  const eligible = (itinerary?.pricingOptions ?? []).filter((option) => !prefer || prefer(option));
  const hasCabin = (option: { cabinClass?: string }): boolean => typeof option.cabinClass === 'string' && option.cabinClass !== '';
  if (prefer && !eligible.every(hasCabin)) throw new DomainError('OFFER_NO_LONGER_AVAILABLE'); // una tarifa que cumple la preferencia pero no tiene cabina: no se adivina con otra
  const cabins = [...new Set(eligible.filter(hasCabin).map((option) => option.cabinClass as string))];
  if (cabins.length !== 1) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
  return cabins[0];
}

/** Versión curry de `cabinOfSegment` para repartir los asientos de una reserva. */
export function cabinBySegment(itineraries: unknown[], prefer?: (option: { fareRules?: { isChangeable?: boolean } }) => boolean): (segmentId: string) => string {
  return (segmentId) => cabinOfSegment(itineraries, segmentId, prefer);
}

/** Asientos y equipaje extra que los pasajeros pidieron al reservar; se reservan al aprobarse el pago. Cada asiento lleva la cabina comprada de SU segmento (Ancillaries la compara con la del asiento). */
export function allocationOf(passengers: unknown[], itineraries: unknown[] = []): { assignments: Array<Record<string, unknown>>; baggage: Array<Record<string, unknown>> } {
  const data = passengers as PassengerData[]; const cabinOf = cabinBySegment(itineraries);
  return {
    assignments: data.flatMap((passenger) => (passenger.assignedSeats ?? []).map((seat) => ({ ...seat, passengerId: passenger.passengerId, passengerType: passenger.passengerType, cabinClass: cabinOf(seat.segmentId) }))),
    baggage: data.flatMap((passenger) => (passenger.extraBaggage ?? []).map((item) => ({ ...item, passengerId: passenger.passengerId })))
  };
}

/**
 * Asientos apartados por el hold (ADR-F12b2fix-01). Si la reserva no trae ninguno, se reparten en el orden de los pasajeros (los infantes no
 * ocupan asiento): los sobrantes no se asignan (los libera la reserva) y un pasajero sin asiento queda sin asiento. Si la reserva trae
 * asientos, mandan los de la reserva (iguales u otros) y los del hold se liberan al reservar.
 */
export function withHeldSeats<T>(passengers: T[], held: Array<{ segmentId: string; seatNumber: string }>): T[] {
  const list = passengers as unknown as PassengerData[];
  if (!held.length || list.some((passenger) => (passenger.assignedSeats?.length ?? 0) > 0)) return passengers;
  const bySegment = new Map<string, string[]>();
  for (const seat of held) bySegment.set(seat.segmentId, [...(bySegment.get(seat.segmentId) ?? []), seat.seatNumber]);
  const travelers = list.filter((passenger) => passenger.passengerType !== 'INFANT');
  return list.map((passenger) => {
    const index = travelers.indexOf(passenger);
    if (index < 0) return passenger as unknown as T;
    const assignedSeats = [...bySegment.entries()].flatMap(([segmentId, seats]) => seats[index] ? [{ segmentId, seatNumber: seats[index] }] : []);
    return (assignedSeats.length ? { ...passenger, assignedSeats } : passenger) as unknown as T;
  });
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

/** Identificador de reembolso que se informa a Booking: estable por cotización. */
export const refundIdFor = (quoteId: string): string => `REF-VUE-${createHash('sha256').update(quoteId).digest('hex').slice(0, 8).toUpperCase()}`;
/** Asientos de inventario que ocupa la reserva (los infantes viajan sin asiento). */
export const seatsOf = (reservation: StoredReservation): number => (reservation.passengers as Array<{ passengerType?: string }>).filter((passenger) => passenger.passengerType !== 'INFANT').length;

type TicketLike = { ticketId?: string; eTicketNumber?: string; passengerId?: string };
export const ticketSummary = (tickets: unknown[]): TicketLike[] => (tickets as TicketLike[]).map((ticket) => ({ ticketId: ticket.ticketId, eTicketNumber: ticket.eTicketNumber, passengerId: ticket.passengerId }));

const TRANSLATABLE = new Set<string>(['SEAT_TAKEN', 'SEAT_CABIN_MISMATCH', 'INFANT_SEAT_NOT_ALLOWED', 'BAGGAGE_LIMIT_EXCEEDED', 'OFFER_NO_LONGER_AVAILABLE']);
/**
 * Código del catálogo de un error de dominio que una dependencia (Ancillaries, Inventory) devolvió por gRPC. Sirve para registrar
 * la causa de un fallo (p. ej. `errorCode` de booking.failed); la respuesta al cliente la deja pasar el filtro gRPC de Reservation.
 */
export function translateDependencyError(error: unknown): unknown {
  if (error instanceof DomainError || typeof error !== 'object' || error === null) return error;
  const details = (error as { details?: unknown }).details;
  return typeof details === 'string' && TRANSLATABLE.has(details) && (ERROR_CODES as readonly string[]).includes(details) ? new DomainError(details as ErrorCode) : error;
}
