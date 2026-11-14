import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { formatLocalDate, formatLocalTime, formatMoney, zoneLabel } from '@flight-platform/format';
import { IssueTicketsOperation } from '@flight-platform/graphql-schema/generated/operations';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { newCorrelationId } from '../data/identity';
import { toAppError, type AppError } from '../data/errors';
import { RequireSession, StatusBadge } from '../purchase/Shared';
import { ItinerariesView, PassengersView, TicketsView } from './BookingView';
import { useBooking } from './useBooking';
import s from '../purchase/purchase.module.css';

/** Detalle de una reserva (§3.10): estado, itinerarios, pasajeros, boletos, historial y las acciones que su estado permite (`booking(bookingId)`; la lista no las trae). */
export function BookingDetailPage() {
  return <RequireSession><BookingDetailScreen /></RequireSession>;
}

function BookingDetailScreen() {
  usePageTitle('Mi reserva');
  const { bookingId = '' } = useParams(); const location = useLocation(); const { client } = useServices();
  const state = useBooking(bookingId, { poll: true });
  const [issuing, setIssuing] = useState(false); const [issueError, setIssueError] = useState<AppError | null>(null);
  const notice = ((location.state ?? {}) as { notice?: string }).notice;

  if (state.loading) return <div className={pageClass}><LoadingState phase="normal" label="Cargando tu reserva" /></div>;
  if (state.error && !state.booking) {
    // Inexistente y ajena se ven igual (404): mensaje único.
    if (state.error.category === 'NOT_FOUND') {
      return <div className={pageClass}><div className={ui.statePage}><h1>Reserva no encontrada</h1><p>No encontramos esa reserva en tu cuenta.</p><ButtonLink to="/reservas">Ir a mis reservas</ButtonLink></div></div>;
    }
    return <div className={pageClass}><ErrorPanel error={state.error} onRetry={state.reload} /></div>;
  }
  const booking = state.booking!; const actions = booking.availableActions; const id = encodeURIComponent(booking.bookingId);
  const pending = booking.status === 'CHANGE_PENDING' || booking.status === 'CANCELLATION_PENDING';
  const zoneIata = booking.itineraries?.[0]?.segments[0]?.departure.iataCode ?? '';
  const postsale = actions.some((action) => ['baggage-options', 'seats', 'date-change-search', 'cancellation-quote'].includes(action));
  const retryIssue = async (): Promise<void> => {
    setIssuing(true); setIssueError(null);
    try { const result = await client.execute(IssueTicketsOperation, { bookingId: booking.bookingId }, { correlationId: newCorrelationId() }); state.setBooking(result.issueTickets.booking); } catch (failure) { setIssueError(toAppError(failure)); } finally { setIssuing(false); }
  };

  return (
    <div className={pageClass}>
      <div className={s.between}>
        <div>
          <span className={ui.eyebrow}>Código de reserva</span>
          <h1 className={s.heading}><span className={s.pnr} data-testid="pnr">{booking.pnr}</span></h1>
          <p className={s.row}><StatusBadge status={booking.status} /><strong>{formatMoney(booking.grandTotal)}</strong></p>
        </div>
        <div className={ui.actions} data-print="hide">
          {actions.includes('check-in') || actions.includes('boarding-passes') ? <ButtonLink to={`/reservas/${id}/checkin`}>Check-in y pase de abordar</ButtonLink> : null}
          {postsale ? <ButtonLink variant="secondary" to={`/reservas/${id}/postventa`}>Gestionar mi reserva</ButtonLink> : null}
          {actions.includes('issue-tickets') ? <Button variant="secondary" loading={issuing} onClick={() => void retryIssue()}>Reintentar la emisión</Button> : null}
          <Button variant="secondary" onClick={() => window.print()}>Imprimir</Button>
        </div>
      </div>

      {notice === 'change-done' ? <Notice kind="success" title="Cambiamos la fecha de tu viaje."><p>Revisa los nuevos horarios más abajo.</p></Notice> : null}
      {notice === 'change-pending' ? <Notice kind="info" title="Tu cambio de fecha está en proceso."><p>Te mostraremos el resultado en esta página en unos minutos.</p></Notice> : null}
      {pending ? <Notice kind="info" title="Hay una operación en proceso."><p>Mientras se completa no puedes hacer otros cambios. Esta página se actualiza sola.</p></Notice> : null}
      {booking.status === 'CANCELLED' ? <Notice kind="warning" title="Esta reserva está cancelada."><p>Solo puedes consultarla.</p></Notice> : null}
      {booking.status === 'FAILED' ? <Notice kind="error" title="Esta reserva no se completó."><p>No se realizó ningún cargo. Puedes buscar de nuevo y reservar otra vez.</p></Notice> : null}
      {issueError ? <ErrorPanel error={issueError} onRetry={() => void retryIssue()} /> : null}
      {state.error ? <ErrorPanel error={state.error} onRetry={state.reload} /> : null}

      <div className={`${s.stack} ${s.top}`}>
        <ItinerariesView booking={booking} />
        <section className={ui.card} aria-labelledby="pax-title"><h2 id="pax-title">Pasajeros</h2><PassengersView booking={booking} /></section>
        <section className={ui.card} aria-labelledby="tickets-title"><h2 id="tickets-title">Boletos</h2><TicketsView booking={booking} /></section>
        {booking.changes && booking.changes.length > 0 ? (
          <section className={ui.card} aria-labelledby="hist-title">
            <h2 id="hist-title">Historial</h2>
            <ul className={s.list}>
              {booking.changes.map((change, index) => (
                <li key={`${change.changedAt}-${index}`}><strong>{change.changedAt && zoneIata ? `${formatLocalDate(change.changedAt, zoneIata)} ${formatLocalTime(change.changedAt, zoneIata)} (${zoneLabel(zoneIata)})` : ''}</strong> {change.description}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
