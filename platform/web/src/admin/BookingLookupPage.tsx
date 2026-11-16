import { useRef, useState, type FormEvent } from 'react';
import { formatDate } from '@flight-platform/format';
import { AdminBookingByPnrOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { AdminBookingByPnrQuery, AdminCheckInMutation } from '@flight-platform/graphql-schema/generated/types';
import { CheckInSection } from './CheckInSection';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { toAppError, type AppError } from '../data/errors';
import { newCorrelationId } from '../data/identity';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { DataTable } from './parts';
import { bookingStatusLabel, channelLabel, checkInStatusLabel, normalizePnr, passengerTypeLabel, splitLocal, ticketStatusLabel } from './pnr-rules';
import a from './admin.module.css';

type Booking = NonNullable<AdminBookingByPnrQuery['adminBookingByPnr']>;
type CheckInResult = AdminCheckInMutation['adminCheckIn'];
type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'found'; booking: Booking } | { kind: 'missing' } | { kind: 'error'; error: AppError };

const when = (local: string, iata: string): string => { const { date, time } = splitLocal(local); return `${formatDate(date)} · ${time} (hora local de ${iata})`; };

function Result({ booking, onChecked }: { booking: Booking; onChecked: (result: CheckInResult) => void }) {
  const names = new Map(booking.passengers.map((passenger) => [passenger.passengerId, `${passenger.firstName} ${passenger.lastName}`]));
  const flightOf = new Map(booking.segments.map((segment) => [segment.segmentId, segment.flightNumber]));
  return (
    <section className={`${ui.card} ${a.panel}`} aria-labelledby="booking-title" data-testid="booking-result">
      <h2 id="booking-title">Reserva <code>{booking.pnr}</code></h2>
      <dl className={a.diff}>
        <div className={a.diffRow}><dt>Estado</dt><dd>{bookingStatusLabel(booking.status)}</dd><dd /></div>
        <div className={a.diffRow}><dt>Canal</dt><dd>{channelLabel(booking.channel)}{booking.partnerRef ? <> · referencia del socio <code className={a.wrapCode}>{booking.partnerRef}</code></> : null}</dd><dd /></div>
        <div className={a.diffRow}><dt>Total</dt><dd>{booking.grandTotal.total} {booking.grandTotal.currency}</dd><dd /></div>
        <div className={a.diffRow}><dt>Check-in</dt><dd>{checkInStatusLabel(booking.checkIn.status)}</dd><dd /></div>
      </dl>

      <DataTable caption="Vuelos de la reserva">
        <thead><tr><th scope="col">Vuelo</th><th scope="col">Ruta</th><th scope="col">Salida</th><th scope="col">Llegada</th><th scope="col">Cabina</th></tr></thead>
        <tbody>
          {booking.segments.map((segment) => (
            <tr key={segment.segmentId}>
              <th scope="row">{segment.flightNumber}</th><td>{segment.origin} → {segment.destination}</td>
              <td>{when(segment.departureLocal, segment.origin)}</td><td>{when(segment.arrivalLocal, segment.destination)}</td><td>{segment.cabinClass ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <DataTable caption="Pasajeros (solo nombres)">
        <thead><tr><th scope="col">Pasajero</th><th scope="col">Tipo</th><th scope="col">Asientos</th><th scope="col">Equipaje extra</th><th scope="col">Check-in</th></tr></thead>
        <tbody>
          {booking.passengers.map((passenger) => {
            const state = booking.checkIn.passengers.find((entry) => entry.passengerId === passenger.passengerId);
            return (
              <tr key={passenger.passengerId}>
                <th scope="row">{passenger.firstName} {passenger.lastName}</th><td>{passengerTypeLabel(passenger.passengerType)}</td>
                <td>{passenger.seats.length ? passenger.seats.map((seat) => `${flightOf.get(seat.segmentId) ?? 'Tramo'}: ${seat.seatNumber}`).join(' · ') : '—'}</td>
                <td>{passenger.extraBaggage.length ? passenger.extraBaggage.reduce((sum, entry) => sum + entry.quantity, 0) : 0}</td>
                <td>{state ? checkInStatusLabel(state.status) : checkInStatusLabel('NOT_STARTED')}</td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>

      <DataTable caption="Boletos">
        <thead><tr><th scope="col">Pasajero</th><th scope="col">Boleto</th><th scope="col">Estado</th><th scope="col">Cupones</th></tr></thead>
        <tbody>
          {booking.tickets.length === 0 ? <tr><td colSpan={4}>Sin boletos emitidos.</td></tr> : booking.tickets.map((ticket, index) => (
            <tr key={`${ticket.passengerId}-${index}`}>
              <th scope="row">{names.get(ticket.passengerId) ?? 'Pasajero'}</th><td>{ticket.eTicketLast4 ? `•••• ${ticket.eTicketLast4}` : '—'}</td><td>{ticketStatusLabel(ticket.status)}</td>
              <td>{ticket.segments.map((segment) => `${flightOf.get(segment.segmentId) ?? 'Tramo'}: ${ticketStatusLabel(segment.status)}`).join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <CheckInSection key={booking.bookingId} booking={booking} onChecked={onChecked} />
    </section>
  );
}

/**
 * Buscar una reserva por localizador (PNR), de cualquier canal (F12c-4a, ADR-F12c4-01). SOLO LECTURA: nombres, vuelos en hora local, asientos, equipaje, boletos
 * (últimos 4 dígitos) y estado del check-in; nunca documentos, correos, teléfonos ni referencias de pago. Cada búsqueda queda registrada (quién, qué PNR, cuándo).
 * Una reserva inexistente, ajena o un localizador mal escrito se muestran con el mismo mensaje.
 */
export function BookingLookupPage() {
  usePageTitle('Buscar reserva');
  const { client } = useServices();
  const [text, setText] = useState(''); const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const generation = useRef(0);

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (phase.kind === 'loading') return;
    const pnr = normalizePnr(text);
    const mine = ++generation.current; setPhase({ kind: 'loading' });
    try {
      const data = await client.execute(AdminBookingByPnrOperation, { pnr }, { correlationId: newCorrelationId() });
      if (mine !== generation.current) return;
      setPhase(data.adminBookingByPnr ? { kind: 'found', booking: data.adminBookingByPnr } : { kind: 'missing' });
    } catch (failure) { if (mine === generation.current) setPhase({ kind: 'error', error: toAppError(failure) }); }
  };

  return (
    <>
      <div><span className={ui.eyebrow}>Atención al cliente</span><h1>Buscar reserva</h1></div>
      <Notice kind="info" title="Cada búsqueda y cada check-in queda registrado."><p>Se busca por localizador (PNR) en cualquier canal, web o socio. No se muestran documentos de identidad, correos, teléfonos ni referencias de pago. Límites por hora: 30 búsquedas y 60 check-ins.</p></Notice>
      <form className={`${ui.card} ${a.panel}`} onSubmit={(event) => void search(event)} noValidate aria-label="Buscar reserva por localizador">
        <TextField label="Localizador (PNR)" value={text} onChange={(event) => setText(event.target.value.toUpperCase())} maxLength={6} autoComplete="off" autoCapitalize="characters" spellCheck={false} hint="Seis caracteres, por ejemplo J4R8GZ" />
        <div className={ui.actions}><Button type="submit" loading={phase.kind === 'loading'}>Buscar</Button></div>
      </form>
      {phase.kind === 'loading' ? <LoadingState phase="normal" label="Buscando la reserva" skeletons={1} /> : null}
      {phase.kind === 'missing' ? <div className={`${ui.card} ${a.empty}`} role="status" data-testid="booking-missing"><h2>Reserva no encontrada</h2><p className={a.muted}>No hay una reserva con ese localizador.</p></div> : null}
      {phase.kind === 'error' ? <ErrorPanel error={phase.error} onRetry={() => setPhase({ kind: 'idle' })} /> : null}
      {phase.kind === 'found' ? <Result booking={phase.booking} onChecked={(result) => setPhase((previous) => (previous.kind === 'found' ? { kind: 'found', booking: { ...previous.booking, checkIn: { status: result.status, passengers: result.checkedInPassengers } } } : previous))} /> : null}
    </>
  );
}
