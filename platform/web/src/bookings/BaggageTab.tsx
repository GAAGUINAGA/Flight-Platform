import { useMemo, useRef, useState } from 'react';
import { formatMoney } from '@flight-platform/format';
import { AddBaggageOperation, BaggageOptionsOperation } from '@flight-platform/graphql-schema/generated/operations';
import { usePurchase, useQuery, useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { multiplyAmount, sumAmounts } from '../purchase/amounts';
import { paymentReference } from '../purchase/intent';
import { useAction } from './useAction';
import type { Booking } from './useBooking';
import s from '../purchase/purchase.module.css';

/** Postventa · Equipaje (§3.11): opciones por pasajero y tramo → cantidad → resumen con importe y condiciones → pagar. 200 síncrono. */
export function BaggageTab({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const { client } = useServices(); const { store } = usePurchase();
  const query = useQuery(BaggageOptionsOperation, { bookingId: booking.bookingId }, `${booking.bookingId}:bag`);
  const [quantities, setQuantities] = useState<Record<string, number>>({}); const [confirming, setConfirming] = useState(false); const [done, setDone] = useState(false);
  /** Líneas ya confirmadas por el servidor dentro de la intención en curso (clave → cantidad). Nunca se reenvían; se vacía al terminar o descartar. */
  const confirmedRef = useRef(new Map<string, number>()); const [confirmed, setConfirmed] = useState<Record<string, number>>({});
  const action = useAction();
  const names = useMemo(() => new Map((booking.passengers ?? []).map((passenger) => [passenger.passengerId, `${passenger.firstName} ${passenger.lastName}`])), [booking]);
  const flights = useMemo(() => new Map((booking.itineraries ?? []).map((itinerary) => [itinerary.itineraryId, itinerary.segments.map((segment) => segment.flightNumber).join(', ')])), [booking]);

  if (query.status === 'loading') return <LoadingState phase={query.phase} label="Consultando el equipaje disponible" onRetry={query.reload} />;
  if (query.status === 'error') return <ErrorPanel error={query.error} onRetry={query.reload} />;
  if (query.status !== 'success') return null;
  const options = query.data.baggageOptions;
  const key = (o: { passengerId: string; itineraryId: string }): string => `${o.passengerId}|${o.itineraryId}`;
  const chosen = options.filter((option) => (quantities[key(option)] ?? 0) > 0);
  const lines = chosen.map((option) => ({ option, quantity: quantities[key(option)], total: option.price ? multiplyAmount(option.price.total, quantities[key(option)]) : null }));
  const total = sumAmounts(lines.map((line) => line.total ?? '0.00')).total; const currency = options[0]?.price?.currency ?? booking.grandTotal.currency;

  const lineKey = (line: { option: { passengerId: string; itineraryId: string } }): string => `baggage:${key(line.option)}`;
  const isConfirmed = (line: { option: { passengerId: string; itineraryId: string }; quantity: number }): boolean => confirmed[key(line.option)] === line.quantity;
  const partial = Object.keys(confirmed).length > 0;
  const pending = lines.filter((line) => !isConfirmed(line));

  /**
   * UNA Idempotency-Key por línea, conservada mientras dure la intención: un reintento solo envía las líneas NO confirmadas y cada una
   * con su misma clave. Una línea confirmada no se reenvía jamás (comprarla dos veces sería cobrar dos veces).
   */
  const confirm = async (): Promise<void> => {
    const signature = JSON.stringify(lines.map((line) => [key(line.option), line.quantity]));
    const result = await action.run('baggage', signature, async (group) => {
      for (const line of lines) {
        if (confirmedRef.current.get(key(line.option)) === line.quantity) continue;
        const payload = { bookingId: booking.bookingId, passengerId: line.option.passengerId, itineraryId: line.option.itineraryId, quantity: line.quantity };
        const item = store.intents.begin(lineKey(line), String(line.quantity), group.correlationId);
        try {
          await client.execute(AddBaggageOperation, { input: { ...payload, paymentReference: paymentReference('ok', item.nonce) }, idempotencyKey: item.idempotencyKey }, { correlationId: group.correlationId });
        } catch (failure) { store.intents.settle(lineKey(line), { error: failure }); throw failure; }
        store.intents.settle(lineKey(line));
        confirmedRef.current.set(key(line.option), line.quantity); setConfirmed(Object.fromEntries(confirmedRef.current));
      }
      return true;
    });
    if (result) { confirmedRef.current.clear(); setConfirmed({}); setDone(true); setConfirming(false); setQuantities({}); query.reload(); onDone(); }
  };
  /** Abandona lo pendiente (lo ya confirmado queda en la reserva) y vuelve a consultar lo que hay comprado. */
  const discard = (): void => {
    for (const line of pending) store.intents.settle(lineKey(line));
    store.intents.settle('baggage'); confirmedRef.current.clear(); setConfirmed({}); action.clearError(); setConfirming(false); setQuantities({}); query.reload(); onDone();
  };

  if (options.length === 0) return <Notice kind="info" title="No hay equipaje adicional disponible para esta reserva."><p>Tu tarifa no permite agregar maletas en este momento.</p></Notice>;
  return (
    <div className={s.stack}>
      {done ? <Notice kind="success" title="Agregamos tu equipaje."><p>El equipaje adicional ya figura en tu reserva.</p></Notice> : null}
      <table className={s.table}>
        <caption className={ui.srOnly}>Equipaje adicional por pasajero y tramo</caption>
        <thead><tr><th scope="col">Pasajero</th><th scope="col">Vuelo</th><th scope="col">Precio por maleta</th><th scope="col">Ya compradas</th><th scope="col">Agregar</th></tr></thead>
        <tbody>
          {options.map((option) => {
            const max = Math.max(0, (option.maxAllowed ?? 0) - (option.alreadyPurchased ?? 0)); const id = `qty-${key(option)}`;
            return (
              <tr key={key(option)}>
                <th scope="row">{names.get(option.passengerId) ?? option.passengerId}</th>
                <td>{flights.get(option.itineraryId) ?? option.itineraryId}</td>
                <td>{option.price ? formatMoney(option.price) : '—'}</td>
                <td>{option.alreadyPurchased ?? 0}</td>
                <td>
                  <label className={ui.srOnly} htmlFor={id}>Maletas adicionales de {names.get(option.passengerId) ?? 'pasajero'} en {flights.get(option.itineraryId) ?? 'el tramo'}</label>
                  <select id={id} className={ui.control} value={quantities[key(option)] ?? 0} disabled={max === 0 || partial} onChange={(event) => { setConfirming(false); setQuantities((previous) => ({ ...previous, [key(option)]: Number(event.target.value) })); }}>
                    {Array.from({ length: max + 1 }, (_, quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lines.length > 0 && !confirming ? <div className={s.row}><Button onClick={() => { setDone(false); setConfirming(true); }}>Revisar y pagar</Button></div> : null}
      {confirming && lines.length > 0 ? (
        <section className={`${ui.card} ${s.stackSmall}`} aria-label="Resumen del equipaje">
          <h3>Confirma tu compra de equipaje</h3>
          <dl className={s.lines}>
            {lines.map((line) => <div key={key(line.option)} className={s.line}><dt>{names.get(line.option.passengerId)} · {flights.get(line.option.itineraryId)} · {line.quantity} × {line.option.price ? formatMoney(line.option.price) : '—'}{partial ? <strong> · {isConfirmed(line) ? 'Confirmada' : 'Falta confirmar'}</strong> : null}</dt><dd>{line.total ? formatMoney({ currency, total: line.total }) : '—'}</dd></div>)}
          </dl>
          {partial ? <Notice kind="warning" title={`Confirmamos ${lines.length - pending.length} de ${lines.length} líneas.`}><p>Las confirmadas ya figuran en tu reserva y no se vuelven a cobrar. Reintenta para completar las que faltan.</p></Notice> : null}
          <div className={s.total}><span>Total a pagar</span><span>{formatMoney({ currency, total })}</span></div>
          <p className={s.muted}>El equipaje adicional se agrega a tu reserva para los vuelos indicados y no es reembolsable una vez comprado.</p>
          {action.error ? <ErrorPanel error={action.error} onRetry={() => void confirm()} onRetryPayment={action.clearError} /> : null}
          <div className={s.row}>
            <Button loading={action.busy} onClick={() => void confirm()}>{partial ? 'Reintentar las líneas que faltan' : `Pagar ${formatMoney({ currency, total })}`}</Button>
            {partial ? <Button variant="secondary" onClick={discard}>Descartar las que faltan</Button> : <Button variant="secondary" onClick={() => setConfirming(false)}>Volver</Button>}
          </div>
        </section>
      ) : null}
    </div>
  );
}
