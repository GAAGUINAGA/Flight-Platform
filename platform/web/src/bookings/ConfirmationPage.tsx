import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { CircleCheck, Clock, CircleX } from 'lucide-react';
import { formatMoney } from '@flight-platform/format';
import { IssueTicketsOperation } from '@flight-platform/graphql-schema/generated/operations';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import ui from '../components/ui/ui.module.css';
import { newCorrelationId } from '../data/identity';
import { toAppError, type AppError } from '../data/errors';
import { RequireSession, Stepper } from '../purchase/Shared';
import { ItinerariesView, PassengersView, TicketsView } from './BookingView';
import { useBooking, type Booking } from './useBooking';
import s from '../purchase/purchase.module.css';

/** Confirmación (diseño F12c-0 §3.8): el PNR y los boletos (201), o el pago pendiente / la emisión en curso (202) con su explicación. */
export function ConfirmationPage() {
  return <RequireSession><ConfirmationScreen /></RequireSession>;
}

function ConfirmationScreen() {
  usePageTitle('Confirmación de tu reserva');
  const { bookingId = '' } = useParams(); const location = useLocation(); const { client } = useServices();
  const initial = ((location.state ?? {}) as { booking?: Booking }).booking ?? null;
  const state = useBooking(bookingId, { initial: initial && initial.bookingId === bookingId ? initial : null, poll: true });
  const [issuing, setIssuing] = useState(false); const [issueError, setIssueError] = useState<AppError | null>(null);
  const { booking } = state;

  if (!booking) {
    if (state.error) return <div className={pageClass}><ErrorPanel error={state.error} onRetry={state.reload} /></div>;
    return <div className={pageClass}><LoadingState phase="normal" label="Cargando tu reserva" /></div>;
  }
  const retryIssue = async (): Promise<void> => {
    setIssuing(true); setIssueError(null);
    try { const result = await client.execute(IssueTicketsOperation, { bookingId }, { correlationId: newCorrelationId() }); state.setBooking(result.issueTickets.booking); } catch (failure) { setIssueError(toAppError(failure)); } finally { setIssuing(false); }
  };
  const status = booking.status; const actions = booking.availableActions;
  const done = status === 'CONFIRMED'; const failed = status === 'FAILED'; const waiting = !done && !failed;

  return (
    <div className={pageClass}>
      <Stepper current={4} />
      <div className={`${ui.card} ${s.confirm}`}>
        <span className={`${s.confirmIcon} ${done ? s.confirmOk : failed ? s.confirmFail : s.confirmWait}`}>
          {done ? <CircleCheck size={40} aria-hidden="true" /> : failed ? <CircleX size={40} aria-hidden="true" /> : <Clock size={40} aria-hidden="true" />}
        </span>
        <h1 className={s.heading}>
          {done ? '¡Tu reserva está confirmada!' : status === 'PENDING_PAYMENT' ? 'Estamos confirmando tu pago' : status === 'TICKET_ISSUING' ? 'Estamos emitiendo tus boletos' : failed ? 'No pudimos completar tu reserva' : 'Tu reserva está en proceso'}
        </h1>
        {done || waiting ? (<><p className={s.muted}>Código de reserva</p><p className={s.pnr} data-testid="pnr">{booking.pnr}</p></>) : null}
        {status === 'PENDING_PAYMENT' ? <p role="status">Tu reserva quedó registrada y estamos esperando la confirmación del pago. Esta página se actualiza sola; también puedes volver más tarde desde «Mis reservas».</p> : null}
        {status === 'TICKET_ISSUING' ? <p role="status">Tu pago está confirmado y estamos emitiendo los boletos. Esta página se actualiza sola; también puedes volver más tarde desde «Mis reservas».</p> : null}
        {failed ? <p>La reserva no se completó y no se realizó ningún cargo. Puedes buscar de nuevo y reservar otra vez.</p> : null}
        {waiting && state.gaveUp ? <p role="status">Sigue en proceso. Revisa «Mis reservas» en unos minutos.</p> : null}
        {done ? <p>Total: <strong>{formatMoney(booking.grandTotal)}</strong></p> : null}
        <div className={ui.actions} data-print="hide">
          {failed ? <ButtonLink to="/">Buscar vuelos</ButtonLink> : <ButtonLink to={`/reservas/${encodeURIComponent(booking.bookingId)}`}>Ver mi reserva</ButtonLink>}
          {done ? <Button variant="secondary" onClick={() => window.print()}>Imprimir comprobante</Button> : null}
          {done && actions.includes('check-in') ? <ButtonLink variant="secondary" to={`/reservas/${encodeURIComponent(booking.bookingId)}/checkin`}>Hacer check-in</ButtonLink> : null}
          {waiting && actions.includes('issue-tickets') ? <Button variant="secondary" loading={issuing} onClick={() => void retryIssue()}>Reintentar la emisión</Button> : null}
          {waiting ? <Button variant="secondary" onClick={state.reload}>Actualizar</Button> : null}
        </div>
        {issueError ? <ErrorPanel error={issueError} onRetry={() => void retryIssue()} /> : null}
      </div>

      {done || waiting ? (
        <div className={`${s.stack} ${s.top}`}>
          <ItinerariesView booking={booking} />
          <section className={ui.card} aria-labelledby="pax-title"><h2 id="pax-title">Pasajeros</h2><PassengersView booking={booking} /></section>
          <section className={ui.card} aria-labelledby="tickets-title"><h2 id="tickets-title">Boletos</h2><TicketsView booking={booking} /></section>
        </div>
      ) : null}
    </div>
  );
}
