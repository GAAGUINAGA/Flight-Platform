type Json = Record<string, unknown>;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const list = (value: unknown): Json[] => Array.isArray(value) ? value.filter((item): item is Json => typeof item === 'object' && item !== null) : [];
const optional = (key: string, value: unknown): Json => typeof value === 'string' && value !== '' ? { [key]: value } : {};

/**
 * Vista pública del administrador de una reserva (F12c-4a). Lista BLANCA, repetida aquí aunque Reservation ya la reduce
 * (defensa en profundidad): nunca copia el objeto recibido, así que un campo nuevo (documento, correo, teléfono, pago, dueño…) no sale.
 */
export function publicAdminBooking(view: Json, checkIn: Json): Json {
  const channel = view.channel === 'WEB' ? 'WEB' : 'PARTNER';
  const total = (view.grandTotal ?? {}) as Json;
  return {
    bookingId: text(view.bookingId), pnr: text(view.pnr), status: text(view.status), channel,
    ...(channel === 'PARTNER' ? optional('partnerRef', view.partnerRef) : {}),
    createdAt: text(view.createdAt), grandTotal: { currency: text(total.currency), total: text(total.total) },
    segments: list(view.segments).map((segment) => ({
      segmentId: text(segment.segmentId), flightNumber: text(segment.flightNumber), origin: text(segment.origin), destination: text(segment.destination),
      departureAt: text(segment.departureAt), arrivalAt: text(segment.arrivalAt), departureLocal: text(segment.departureLocal), arrivalLocal: text(segment.arrivalLocal),
      ...optional('status', segment.status), ...optional('cabinClass', segment.cabinClass)
    })),
    passengers: list(view.passengers).map((passenger) => ({
      passengerId: text(passenger.passengerId), passengerType: text(passenger.passengerType), firstName: text(passenger.firstName), lastName: text(passenger.lastName),
      seats: list(passenger.seats).map((seat) => ({ segmentId: text(seat.segmentId), seatNumber: text(seat.seatNumber), ...optional('status', seat.status) })),
      extraBaggage: list(passenger.extraBaggage).map((entry) => ({ itineraryId: text(entry.itineraryId), quantity: Number(entry.quantity ?? 0) }))
    })),
    tickets: list(view.tickets).map((ticket) => ({
      passengerId: text(ticket.passengerId), status: text(ticket.status), ...optional('eTicketLast4', ticket.eTicketLast4),
      segments: list(ticket.segments).map((segment) => ({ segmentId: text(segment.segmentId), status: text(segment.status) }))
    })),
    checkIn: {
      status: text(checkIn.status) || 'NOT_STARTED',
      passengers: list(checkIn.passengers).map((passenger) => ({
        passengerId: text(passenger.passengerId), status: text(passenger.status),
        segments: list(passenger.segments).map((segment) => ({ segmentId: text(segment.segmentId), status: text(segment.status), ...optional('seat', segment.seat) }))
      }))
    }
  };
}
