import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plane, Printer } from 'lucide-react';
import { cityOf } from '@flight-platform/format';
import { BoardingPassesOperation, CheckInOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { BoardingPassesQuery, CheckInMutation } from '@flight-platform/graphql-schema/generated/types';
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
import { checkInMessage, checkInWindow, nextPendingSegment, type SegmentRef } from '../purchase/checkin-rules';
import { RequireSession, whenAt } from '../purchase/Shared';
import { QrCode } from './QrCode';
import { useBooking, type Booking } from './useBooking';
import s from '../purchase/purchase.module.css';

type Pass = BoardingPassesQuery['boardingPasses'][number];

/** Check-in (§3.12): ventana en hora local del aeropuerto como AYUDA (la autoridad es el servidor), check-in de todos los elegibles y pase imprimible. */
export function CheckInPage() {
  return <RequireSession><CheckInScreen /></RequireSession>;
}

function CheckInScreen() {
  usePageTitle('Check-in y pase de abordar');
  const { bookingId = '' } = useParams(); const { client, config } = useServices();
  const { booking, loading, error: bookingError, reload } = useBooking(bookingId, { poll: false });
  const [passes, setPasses] = useState<Pass[] | null>(null); const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState<AppError | null>(null); const [result, setResult] = useState<CheckInMutation['checkIn'] | null>(null);

  const loadPasses = useCallback(async (): Promise<void> => {
    setPhase('loading');
    try { setPasses((await client.execute(BoardingPassesOperation, { bookingId }, { correlationId: newCorrelationId() })).boardingPasses); setPhase('ready'); }
    catch (failure) {
      const appError = toAppError(failure);
      // Todavía sin check-in: el servidor responde que aún no hay pases.
      if (appError.code === 'BOARDING_PASS_NOT_AVAILABLE') { setPasses([]); setPhase('ready'); } else { setError(appError); setPhase('error'); }
    }
  }, [client, bookingId]);
  useEffect(() => { void loadPasses(); }, [loadPasses]);

  const segments = useMemo<SegmentRef[]>(() => (booking?.itineraries ?? []).flatMap((itinerary) => itinerary.segments.map((segment) => ({ segmentId: segment.segmentId, departureAt: segment.departure.at, origin: segment.departure.iataCode }))), [booking]);
  const withPass = useMemo(() => new Set((passes ?? []).map((pass) => pass.segmentId)), [passes]);

  const doCheckIn = async (): Promise<void> => {
    setBusy(true); setActionError(null);
    try { setResult((await client.execute(CheckInOperation, { bookingId }, { correlationId: newCorrelationId() })).checkIn); await loadPasses(); reload(); }
    catch (failure) { setActionError(toAppError(failure)); } finally { setBusy(false); }
  };

  if (loading || (phase === 'loading' && !passes)) return <div className={pageClass}><LoadingState phase="normal" label="Cargando tu check-in" /></div>;
  if (bookingError && !booking) return <div className={pageClass}><ErrorPanel error={bookingError} onRetry={reload} /></div>;
  if (phase === 'error' && error) return <div className={pageClass}><ErrorPanel error={error} onRetry={() => void loadPasses()} /></div>;
  const trip = booking!; const detail = `/reservas/${encodeURIComponent(trip.bookingId)}`;
  const next = nextPendingSegment(segments, withPass);
  const win = next ? checkInWindow({ departureAt: next.departureAt, origin: next.origin, openHours: config.checkIn.openHours, closeMinutes: config.checkIn.closeMinutes }) : null;
  const done = (passes ?? []).length > 0;
  const failed = result?.checkedInPassengers.filter((passenger) => passenger.status === 'FAILED') ?? [];

  return (
    <div className={pageClass}>
      <div className={s.between} data-print="hide">
        <div><h1 className={s.heading}>Check-in</h1><p className={s.lead}>Reserva {trip.pnr}</p></div>
        <div className={ui.actions}>
          <ButtonLink variant="secondary" to={detail}>Volver a la reserva</ButtonLink>
          {done ? <Button onClick={() => window.print()}><Printer size={18} aria-hidden="true" />Imprimir pases</Button> : null}
        </div>
      </div>

      {!done || next ? (
        <section className={`${ui.card} ${s.stackSmall}`} aria-label="Check-in" data-print="hide">
          {next ? <p role="status" data-testid="checkin-window">{checkInMessage(win)} Vuelo {flightFor(trip, next.segmentId)}.</p> : <p>No hay vuelos pendientes de check-in.</p>}
          {win?.state === 'before' ?<Notice kind="info" title="Todavía no abre el check-in."><p>Puedes intentarlo: si aún no está disponible te lo indicaremos.</p></Notice> : null}
          {win?.state === 'closed' ?<Notice kind="warning" title="El check-in de este vuelo ya cerró."><p>Si necesitas ayuda, preséntate en el mostrador del aeropuerto.</p></Notice> : null}
          {failed.length > 0 ? <Notice kind="error" title="No pudimos hacer el check-in de algunos pasajeros."><p>Inténtalo de nuevo.</p></Notice> : null}
          {actionError ? <ErrorPanel error={actionError} onRetry={() => void doCheckIn()} /> : null}
          {next ? <div className={s.row}><Button loading={busy} onClick={() => void doCheckIn()}>Hacer check-in</Button></div> : null}
        </section>
      ) : null}

      {done ? (
        <div className={`${s.stack} ${s.top}`} aria-label="Pases de abordar">
          <h2 data-print="hide">Tus pases de abordar</h2>
          <ul className={s.list}>
            {(passes ?? []).map((pass) => <li key={`${pass.passengerId}-${pass.segmentId}`}><BoardingPass pass={pass} booking={trip} /></li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function flightFor(booking: Booking, segmentId: string): string {
  return (booking.itineraries ?? []).flatMap((itinerary) => itinerary.segments).find((segment) => segment.segmentId === segmentId)?.flightNumber ?? '';
}

/** Pase de abordar por pasajero y tramo: fechas y horas en la hora local del aeropuerto, imprimible. */
export function BoardingPass({ pass, booking }: { pass: Pass; booking: Booking }) {
  const segment = (booking.itineraries ?? []).flatMap((itinerary) => itinerary.segments).find((entry) => entry.segmentId === pass.segmentId);
  const passenger = (booking.passengers ?? []).find((entry) => entry.passengerId === pass.passengerId);
  const name = passenger ? `${passenger.lastName} / ${passenger.firstName}`.toUpperCase() : pass.passengerId;
  return (
    <article className={s.pass} aria-label={`Pase de abordar de ${passenger ? `${passenger.firstName} ${passenger.lastName}` : 'pasajero'}${segment ? `, vuelo ${segment.flightNumber}` : ''}`}>
      <div className={s.passHead}><span>Pase de abordar</span><span>{booking.pnr}</span></div>
      <div className={s.passMain}>
        <strong>{name}</strong>
        {segment ? (
          <div className={s.passRoute} aria-label={`${cityOf(segment.departure.iataCode)} a ${cityOf(segment.arrival.iataCode)}`}>
            <span>{segment.departure.iataCode}</span><Plane size={22} aria-hidden="true" /><span>{segment.arrival.iataCode}</span>
          </div>
        ) : null}
        <dl className={s.passFields}>
          {segment ? <div><dt>Vuelo</dt><dd>{segment.flightNumber}</dd></div> : null}
          {segment ? <div><dt>Salida</dt><dd>{whenAt(segment.departure.at, segment.departure.iataCode)}</dd></div> : null}
          <div><dt>Asiento</dt><dd>{pass.seat}</dd></div>
          {pass.boardingGroup ? <div><dt>Grupo</dt><dd>{pass.boardingGroup}</dd></div> : null}
          {pass.boardingPosition ? <div><dt>Posición</dt><dd>{pass.boardingPosition}</dd></div> : null}
          {pass.gate ? <div><dt>Puerta</dt><dd>{pass.gate}</dd></div> : null}
          {segment?.departure.terminal ? <div><dt>Terminal</dt><dd>{segment.departure.terminal}</dd></div> : null}
        </dl>
      </div>
      <div className={s.passCode}>
        <QrCode value={pass.barcode} label={`Código QR del pase de abordar de ${passenger ? `${passenger.firstName} ${passenger.lastName}` : 'pasajero'}`} />
        <span className={s.muted}>Código {pass.barcodeType}</span>
        <code className={s.codeBox}>{pass.barcode}</code>
      </div>
    </article>
  );
}
