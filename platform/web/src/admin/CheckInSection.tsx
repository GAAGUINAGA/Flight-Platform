import { useEffect, useRef, useState } from 'react';
import { AdminBoardingPassesOperation, AdminCheckInOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { AdminBookingByPnrQuery, AdminBoardingPassesQuery, AdminCheckInMutation } from '@flight-platform/graphql-schema/generated/types';
import { useServices } from '../app/services';
import { QrCode } from '../bookings/QrCode';
import { useAction } from '../bookings/useAction';
import { toAppError, type AppError } from '../data/errors';
import { newCorrelationId } from '../data/identity';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { checkInStatusLabel, isCheckInUnknown } from './pnr-rules';
import a from './admin.module.css';

type Booking = NonNullable<AdminBookingByPnrQuery['adminBookingByPnr']>;
type CheckInResult = AdminCheckInMutation['adminCheckIn'];
type Passes = NonNullable<AdminBoardingPassesQuery['adminBoardingPasses']>;

/** ¿Hay al menos un pasajero con check-in hecho en algún tramo? (solo entonces hay pases que mostrar) */
export const hasCheckedIn = (checkIn: Booking['checkIn']): boolean => checkIn.passengers.some((passenger) => passenger.segments.some((segment) => segment.status === 'CHECKED_IN'));

/**
 * Check-in hecho por la AEROLÍNEA sobre una reserva encontrada por PNR (F12c-4b, ADR-F12c4-01). Solo se envía el PNR: el dueño lo resuelve el servidor y se aplican
 * las MISMAS reglas que al cliente (ventana de 48 h a 60 min antes de la salida, reserva confirmada, boletos emitidos); no se puede forzar fuera de la ventana.
 * Dos pasos con confirmación (avisa al socio y emite pases) y una Idempotency-Key por intención. Después se muestran los pases con su QR, como en la web del cliente.
 */
export function CheckInSection({ booking, onChecked }: { booking: Booking; onChecked: (result: CheckInResult) => void }) {
  const { client } = useServices();
  const { busy, error, intent, run, clearError } = useAction();
  const [step, setStep] = useState<'idle' | 'confirm'>('idle'); const [passes, setPasses] = useState<Passes | null>(null); const [passError, setPassError] = useState<AppError | null>(null); const [loadingPasses, setLoadingPasses] = useState(false);
  const [done, setDone] = useState<CheckInResult | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (step === 'confirm') heading.current?.focus(); }, [step]);
  const names = new Map(booking.passengers.map((passenger) => [passenger.passengerId, `${passenger.firstName} ${passenger.lastName}`]));
  const flightOf = new Map(booking.segments.map((segment) => [segment.segmentId, segment]));
  const confirmed = booking.status === 'CONFIRMED';
  // Estado desconocido (Operations no respondió): el check-in también depende de Operations, así que no se ofrece ni él ni los pases hasta volver a consultar.
  const unknown = isCheckInUnknown(booking.checkIn.status);

  const loadPasses = async (): Promise<void> => {
    setLoadingPasses(true); setPassError(null);
    try { const data = await client.execute(AdminBoardingPassesOperation, { pnr: booking.pnr }, { correlationId: newCorrelationId() }); setPasses(data.adminBoardingPasses ?? { bookingId: booking.bookingId, boardingPasses: [] }); }
    catch (failure) { setPassError(toAppError(failure)); } finally { setLoadingPasses(false); }
  };
  const execute = async (): Promise<void> => {
    const result = await run('admin-check-in', booking.pnr, (current) => client.execute(AdminCheckInOperation, { pnr: booking.pnr, idempotencyKey: current.idempotencyKey }, { correlationId: current.correlationId }));
    if (!result) return;
    setDone(result.adminCheckIn); setStep('idle'); onChecked(result.adminCheckIn);
    if (result.adminCheckIn.checkedInPassengers.some((passenger) => passenger.segments.some((segment) => segment.status === 'CHECKED_IN'))) await loadPasses();
  };

  return (
    <section aria-labelledby="checkin-title" className={a.panel} data-testid="checkin-section">
      <h3 id="checkin-title">Check-in de la aerolínea</h3>
      <p className={a.muted}>Estado: {unknown ? 'no se pudo consultar en este momento' : checkInStatusLabel(booking.checkIn.status)}. Se aplican las mismas reglas que al cliente: ventana de 48 horas a 60 minutos antes de la salida, reserva confirmada y boletos emitidos.</p>
      {done ? <Notice kind={done.status === 'COMPLETED' ? 'success' : 'warning'} title={done.status === 'COMPLETED' ? 'Check-in hecho.' : 'El check-in terminó con fallos.'}><p data-testid="checkin-result">{done.checkedInPassengers.map((passenger) => `${names.get(passenger.passengerId) ?? 'Pasajero'}: ${checkInStatusLabel(passenger.status)}`).join(' · ')}</p></Notice> : null}
      {step === 'confirm' ? (
        <div className={a.confirm} data-testid="checkin-confirm">
          <h3 tabIndex={-1} ref={heading}>Confirma el check-in de la reserva {booking.pnr}</h3>
          <Notice kind="warning" title="Esta acción emite pases de abordar y avisa al socio"><p>Se hará el check-in de {booking.passengers.map((passenger) => `${passenger.firstName} ${passenger.lastName}`).join(', ')}. Si la reserva es de un socio, recibirá el aviso de check-in como siempre. Tu usuario queda en el registro de accesos. Fuera de la ventana el check-in se rechaza: no se puede forzar.</p></Notice>
          {error ? <ErrorPanel error={error} idempotencyKey={intent?.idempotencyKey} onRetry={() => void execute()} /> : null}
          <div className={ui.actions}>
            <Button onClick={() => void execute()} loading={busy}>Confirmar check-in</Button>
            <Button variant="secondary" onClick={() => { clearError(); setStep('idle'); }} disabled={busy}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className={ui.actions}>
          <Button onClick={() => { clearError(); setStep('confirm'); }} disabled={!confirmed || unknown} aria-describedby={unknown ? 'checkin-unknown-reason' : undefined}>Hacer check-in</Button>
          {unknown ? <Button variant="secondary" disabled aria-describedby="checkin-unknown-reason">Ver pases de abordar</Button> : null}
          {!unknown && hasCheckedIn(booking.checkIn) && !passes ? <Button variant="secondary" onClick={() => void loadPasses()} loading={loadingPasses}>Ver pases de abordar</Button> : null}
          {unknown ? <span id="checkin-unknown-reason" className={a.muted} data-testid="checkin-unknown-reason">No se puede hacer el check-in ni ver los pases mientras no se conozca el estado del check-in. Vuelve a consultar la reserva.</span> : null}
          {!unknown && !confirmed ? <span className={a.muted}>Solo una reserva confirmada admite check-in.</span> : null}
        </div>
      )}
      {passError ? <ErrorPanel error={passError} onRetry={() => void loadPasses()} /> : null}
      {passes ? (
        <div data-testid="boarding-passes">
          <h4>Pases de abordar</h4>
          {passes.boardingPasses.length === 0 ? <p className={a.muted}>No hay pases disponibles todavía.</p> : (
            <ul className={a.passes}>
              {passes.boardingPasses.map((pass) => { const segment = flightOf.get(pass.segmentId); const name = names.get(pass.passengerId) ?? 'Pasajero'; return (
                <li key={`${pass.passengerId}-${pass.segmentId}`} className={ui.card} data-testid="boarding-pass">
                  <strong>{name}</strong>
                  <span>{segment ? `${segment.flightNumber} · ${segment.origin} → ${segment.destination}` : 'Vuelo'} · asiento {pass.seat}</span>
                  <QrCode value={pass.barcode} label={`Pase de abordar de ${name}, asiento ${pass.seat}`} />
                </li>
              ); })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
