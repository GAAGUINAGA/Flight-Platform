import { Plane } from 'lucide-react';
import { formatDuration } from '@flight-platform/format';
import ui from '../components/ui/ui.module.css';
import { typeLabel } from '../purchase/passenger-rules';
import { whenAt } from '../purchase/Shared';
import { cabinLabel } from '../search/search-model';
import type { Booking } from './useBooking';
import s from '../purchase/purchase.module.css';

/** Piezas de solo lectura de una reserva (confirmación y detalle). Horas SIEMPRE en la zona de cada aeropuerto. */
export const flightOf = (booking: Booking, segmentId: string): string => booking.itineraries?.flatMap((itinerary) => itinerary.segments).find((segment) => segment.segmentId === segmentId)?.flightNumber ?? segmentId;

export function ItinerariesView({ booking }: { booking: Booking }) {
  return (
    <div className={s.stackSmall}>
      {(booking.itineraries ?? []).map((itinerary, index) => (
        <section key={itinerary.itineraryId} className={ui.card} aria-label={`Tramo ${index + 1}`}>
          <h3>{(booking.itineraries ?? []).length > 1 ? `Tramo ${index + 1} · ` : ''}{itinerary.segments[0]?.departure.iataCode} → {itinerary.segments[itinerary.segments.length - 1]?.arrival.iataCode} · {formatDuration(itinerary.totalDurationMinutes)}</h3>
          <ul className={s.list}>
            {itinerary.segments.map((segment) => (
              <li key={segment.segmentId} className={s.stackSmall}>
                <strong><Plane size={14} aria-hidden="true" /> {segment.flightNumber} · {segment.departure.iataCode} → {segment.arrival.iataCode}</strong>
                <span>Sale: {whenAt(segment.departure.at, segment.departure.iataCode)}{segment.departure.terminal ? ` · terminal ${segment.departure.terminal}` : ''}</span>
                <span>Llega: {whenAt(segment.arrival.at, segment.arrival.iataCode)}</span>
                {itinerary.pricingOptions[0] ? <span className={s.muted}>{cabinLabel(itinerary.pricingOptions[0].cabinClass)} · {itinerary.pricingOptions[0].fareBrand}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function bagCount(bags: ReadonlyArray<{ quantity: number }> | null | undefined): string {
  const total = (bags ?? []).reduce((sum, bag) => sum + bag.quantity, 0);
  return total === 0 ? '—' : `${total} ${total === 1 ? 'maleta' : 'maletas'}`;
}

export function PassengersView({ booking }: { booking: Booking }) {
  const passengers = booking.passengers ?? [];
  return (
    <table className={s.table}>
      <caption className={ui.srOnly}>Pasajeros de la reserva</caption>
      <thead><tr><th scope="col">Pasajero</th><th scope="col">Documento</th><th scope="col">Asientos</th><th scope="col">Equipaje adicional</th></tr></thead>
      <tbody>
        {passengers.map((passenger) => (
          <tr key={passenger.passengerId}>
            <th scope="row">{passenger.firstName} {passenger.lastName}<br /><span className={s.muted}>{typeLabel(passenger.passengerType)}</span></th>
            <td>{passenger.documentNumberMasked}</td>
            <td>{passenger.assignedSeats && passenger.assignedSeats.length > 0 ? passenger.assignedSeats.map((seat) => `${flightOf(booking, seat.segmentId)}: ${seat.seatNumber}`).join(' · ') : passenger.passengerType === 'INFANT' ? 'Sin asiento' : '—'}</td>
            <td>{bagCount(passenger.extraBaggage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TICKET_LABEL: Readonly<Record<string, string>> = { PENDING: 'Pendiente', ISSUING: 'Emitiendo', ISSUED: 'Emitido', FAILED: 'No emitido', VOIDED: 'Anulado', REFUNDED: 'Reembolsado' };

export function TicketsView({ booking }: { booking: Booking }) {
  const tickets = booking.tickets ?? []; const names = new Map((booking.passengers ?? []).map((passenger) => [passenger.passengerId, `${passenger.firstName} ${passenger.lastName}`]));
  if (tickets.length === 0) return <p className={s.muted}>Aún no hay boletos emitidos.</p>;
  return (
    <table className={s.table}>
      <caption className={ui.srOnly}>Boletos electrónicos</caption>
      <thead><tr><th scope="col">Pasajero</th><th scope="col">Boleto</th><th scope="col">Estado</th></tr></thead>
      <tbody>
        {tickets.map((ticket) => (
          <tr key={ticket.ticketId}><th scope="row">{names.get(ticket.passengerId) ?? ticket.passengerId}</th><td>{ticket.eTicketNumber ?? '—'}</td><td>{TICKET_LABEL[ticket.status] ?? ticket.status}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
