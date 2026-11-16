import { useEffect, useRef } from 'react';
import { cityOf, formatLocalDate, formatLocalTimeWithZone } from '@flight-platform/format';
import { Link } from 'react-router-dom';
import { AdminFaresOperation, OpenFlightForSaleOperation } from '@flight-platform/graphql-schema/generated/operations';
import { useLiveQuery } from './hooks';
import { useServices } from '../app/services';
import { useAction } from '../bookings/useAction';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import a from './admin.module.css';

export interface OpenTarget { flightInstanceId: string; flightNumber: string; origin: string; destination: string; departureAt: string; cabins: Array<{ cabinClass: string; capacity: number }> }

/** Cabinas con asientos que no tienen ninguna tarifa guardada con total mayor que cero. Solo orienta: la comprobación que manda es la del servidor. */
export const cabinsWithoutFares = (cabins: OpenTarget['cabins'], fares: Array<{ cabinClass: string; price: { total: string } }>): string[] =>
  cabins.filter((cabin) => cabin.capacity > 0 && !fares.some((fare) => fare.cabinClass === cabin.cabinClass && Number(fare.price.total) > 0)).map((cabin) => cabin.cabinClass);
const CABIN_NAME: Readonly<Record<string, string>> = { ECONOMY: 'Económica', PREMIUM_ECONOMY: 'Premium', BUSINESS: 'Ejecutiva', FIRST: 'Primera' };

/**
 * Abrir a la venta un vuelo cerrado (F12c-4c, P8), con confirmación. El Gateway relee las tarifas y solo abre si toda cabina con asientos tiene una guardada
 * (si no: «falta una tarifa»). Al abrirse aparece de inmediato en la web y en las búsquedas de Booking. Idempotency-Key por intención.
 */
export function OpenFlightPanel({ target, onDone, onCancel }: { target: OpenTarget; onDone: (target: OpenTarget) => void; onCancel: () => void }) {
  const { client } = useServices();
  const { busy, error, intent, run, clearError } = useAction();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [target.flightInstanceId]);
  // Si las tarifas cargaron y falta alguna cabina, el botón se deshabilita; si no cargaron, no se bloquea (el servidor decide).
  const stored = useLiveQuery(AdminFaresOperation, { flightInstanceId: target.flightInstanceId }, `open-fares|${target.flightInstanceId}`);
  const missing = stored.data ? cabinsWithoutFares(target.cabins, stored.data.adminFares) : [];
  const execute = async (): Promise<void> => {
    const result = await run('open-flight', target.flightInstanceId, (current) => client.execute(OpenFlightForSaleOperation, { flightInstanceId: target.flightInstanceId, idempotencyKey: current.idempotencyKey }, { correlationId: current.correlationId }));
    if (result) onDone(target);
  };
  return (
    <section className={a.confirm} aria-labelledby="open-title" data-testid="open-flight-confirm">
      <h3 id="open-title" tabIndex={-1} ref={heading}>Abrir a la venta el vuelo {target.flightNumber}</h3>
      <p className={a.muted}>{cityOf(target.origin)} → {cityOf(target.destination)} · {formatLocalDate(target.departureAt, target.origin, { weekday: true })} · {formatLocalTimeWithZone(target.departureAt, target.origin)}</p>
      <Notice kind="warning" title="Aparecerá de inmediato en la web y en Booking"><p>Los clientes y los socios podrán reservarlo en cuanto lo abras. Solo se abre si todas sus cabinas tienen una tarifa guardada.</p></Notice>
      {missing.length > 0 ? <Notice kind="error" title={`Faltan tarifas para: ${missing.map((cabin) => CABIN_NAME[cabin] ?? cabin).join(', ')}.`}><p data-testid="missing-fares">El vuelo sigue cerrado. <Link to="/admin/tarifas">Completa las tarifas</Link> y vuelve a abrirlo.</p></Notice> : null}
      {error ? <ErrorPanel error={error} idempotencyKey={intent?.idempotencyKey} onRetry={() => void execute()} /> : null}
      <div className={ui.actions}>
        <Button onClick={() => void execute()} loading={busy} disabled={missing.length > 0}>Abrir a la venta</Button>
        <Button variant="secondary" onClick={() => { clearError(); onCancel(); }} disabled={busy}>Cancelar</Button>
      </div>
    </section>
  );
}
