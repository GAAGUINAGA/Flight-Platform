import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Landmark, Wallet } from 'lucide-react';
import { brand } from '@flight-platform/brand';
import { formatMoney } from '@flight-platform/format';
import { CreateBookingOperation, ReleaseHoldOperation } from '@flight-platform/graphql-schema/generated/operations';
import { usePageTitle } from '../app/page';
import { usePurchase, useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import ui from '../components/ui/ui.module.css';
import { AppError, toAppError } from '../data/errors';
import { newCorrelationId } from '../data/identity';
import { buildPassengerInputs } from './booking-input';
import { HoldGate, HoldTimer, useHoldClock } from './HoldTimer';
import { paymentReference, runIntent, type PaymentScenario } from './intent';
import { validatePassengers } from './passenger-rules';
import { addAmounts, baggageTotal } from './pricing';
import { FIELD_ERROR_CODES, mapServerErrors } from './server-errors';
import { RequireSession, Stepper, SummaryLine } from './Shared';
import s from './purchase.module.css';

const METHODS = [
  { id: 'card', label: 'Tarjeta de crédito o débito', hint: 'Visa, Mastercard y otras', Icon: CreditCard },
  { id: 'transfer', label: 'Transferencia bancaria', hint: 'Desde tu banco en línea', Icon: Landmark },
  { id: 'wallet', label: 'Billetera digital', hint: 'Paga con tu saldo', Icon: Wallet }
] as const;
type MethodId = typeof METHODS[number]['id'];

/**
 * Pago (diseño F12c-0 §3.7). El procesamiento es SIMULADO: no hay campos de tarjeta (ni número, ni vencimiento, ni código).
 * Una referencia `pay_ok_*` autoriza; los escenarios de rechazo y pendiente solo aparecen si la configuración los habilita.
 * La intención del pago lleva su propia Idempotency-Key: un doble clic o una reconexión no compra dos veces.
 */
export function PaymentPage() {
  return <RequireSession><PaymentScreen /></RequireSession>;
}

function PaymentScreen() {
  usePageTitle('Pago');
  const navigate = useNavigate(); const { client, config } = useServices(); const { state, store } = usePurchase();
  const { offer, drafts } = state; const back = state.back ?? '/';
  const clock = useHoldClock(state.hold?.holdId ?? null);
  const [method, setMethod] = useState<MethodId>('card'); const [scenario, setScenario] = useState<PaymentScenario>('ok');
  const [holderTouched, setHolderTouched] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<AppError | null>(null);
  const lock = useRef(false);

  const segments = useMemo(() => (offer ? offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => ({ departureAt: segment.departure.at, departureIata: segment.departure.iataCode, arrivalIata: segment.arrival.iataCode }))) : []), [offer]);
  const valid = useMemo(() => Object.keys(validatePassengers(drafts, { segments })).length === 0, [drafts, segments]);
  const defaultHolder = drafts[0] ? `${drafts[0].firstName.trim()} ${drafts[0].lastName.trim()}`.trim() : '';
  const holder = state.holder || defaultHolder;

  if (!offer || !state.hold) {
    return <div className={pageClass}><div className={ui.statePage}><h1>No hay una compra en curso</h1><p>Vuelve a los resultados para elegir tu vuelo.</p><ButtonLink to={back}>Volver a los resultados</ButtonLink></div></div>;
  }
  if (!valid) {
    return <div className={pageClass}><div className={ui.statePage}><h1>Faltan datos de los pasajeros</h1><p>Completa los datos de todos los pasajeros para continuar al pago.</p><ButtonLink to="/compra/pasajeros">Ir a los datos de los pasajeros</ButtonLink></div></div>;
  }

  const frozen = clock.hold?.lockedPrice ?? null;
  const extras = baggageTotal(offer, state.selections, drafts.map((draft) => draft.extraBaggage));
  const total = frozen ? addAmounts(frozen.total, extras) : null; const currency = frozen?.currency ?? offer.grandTotal.currency;
  const holderError = holderTouched && holder.trim().length < 3 ? 'Escribe el nombre del titular.' : undefined;

  const releaseAndChooseSeats = async (): Promise<void> => {
    try { await client.execute(ReleaseHoldOperation, { holdId: state.hold!.holdId }, { correlationId: store.correlationId(newCorrelationId) }); } catch { /* ya vencido o liberado */ }
    store.setHold(null); store.intents.clear(); navigate(`/oferta/${encodeURIComponent(offer.offerId)}`);
  };

  const pay = async (): Promise<void> => {
    if (lock.current) return; // un doble clic no lanza una segunda compra
    setHolderTouched(true);
    if (holder.trim().length < 3 || total === null) return;
    lock.current = true; setBusy(true); setError(null);
    const segmentIds = offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => segment.segmentId));
    const passengers = buildPassengerInputs(drafts, segmentIds, state.seats);
    const holdId = state.hold!.holdId;
    try {
      const result = await runIntent(
        store.intents, 'booking', JSON.stringify({ holdId, passengers, scenario }),
        (intent) => client.execute(CreateBookingOperation, { input: { holdId, passengers, paymentReference: paymentReference(scenario, intent.nonce) }, idempotencyKey: intent.idempotencyKey }, { correlationId: intent.correlationId }),
        store.correlationId(newCorrelationId)
      );
      const { booking, outcome } = result.createBooking;
      store.reset();
      navigate(`/reservas/${encodeURIComponent(booking.bookingId)}/confirmacion`, { replace: true, state: { outcome, booking } });
    } catch (failure) {
      const failed = toAppError(failure);
      // Un dato que el servidor rechazó: se lleva al campo y pasajero (lo escrito se conserva en el almacén) en lugar de un aviso general.
      if (FIELD_ERROR_CODES.has(failed.code)) {
        const mapped = mapServerErrors(failed, drafts);
        if (Object.keys(mapped.errors).length > 0) { store.setServerErrors(mapped.errors); navigate('/compra/pasajeros'); return; }
      }
      setError(failed);
    } finally { lock.current = false; setBusy(false); }
  };

  return (
    <div className={pageClass}>
      <Stepper current={3} />
      <h1 className={s.heading}>Pago</h1>
      <p className={s.lead}>Revisa el importe y elige cómo quieres pagar.</p>
      <HoldGate clock={clock} searchHref={back} />

      <div className={s.twoCol}>
        <form className={s.stack} noValidate onSubmit={(event) => { event.preventDefault(); void pay(); }} aria-label="Pago de la reserva">
          <section className={ui.card}>
            <fieldset className={s.methods}>
              <legend className={s.legend2}>Medio de pago</legend>
              {METHODS.map(({ id, label, hint, Icon }) => (
                <label key={id} className={s.method}>
                  <input type="radio" name="medio" value={id} checked={method === id} onChange={() => setMethod(id)} />
                  <Icon size={22} aria-hidden="true" />
                  <span className={s.methodText}><strong>{label}</strong><span className={s.muted}>{hint}</span></span>
                </label>
              ))}
            </fieldset>
          </section>
          <section className={`${ui.card} ${s.stackSmall}`}>
            <TextField label="Titular del pago" autoComplete="cc-name" value={holder} onChange={(event) => { setHolderTouched(true); store.setHolder(event.target.value); }} error={holderError} maxLength={80} />
            {config.testPaymentScenarios ? (
              <SelectField label="Resultado del procesamiento" value={scenario} onChange={(event) => setScenario(event.target.value as PaymentScenario)} hint="Disponible solo en entornos de verificación.">
                <option value="ok">Aprobado</option>
                <option value="denied">Rechazado</option>
                <option value="pending">Pendiente</option>
              </SelectField>
            ) : null}
            <p className={s.demoNote}>{brand.texts.demoPaymentNote}</p>
          </section>
          {error ? <ErrorPanel error={error} onRetry={() => void pay()} onRetryPayment={() => setError(null)} holdStillValid searchHref={back} onRefreshSeats={() => void releaseAndChooseSeats()} fixHref="/compra/pasajeros" fixLabel="Corregir datos" /> : null}
          <div className={s.row}>
            <Button type="submit" loading={busy} disabled={clock.phase === 'expired' || total === null}>{total ? `Pagar ${formatMoney({ currency, total })}` : 'Pagar'}</Button>
            <ButtonLink variant="secondary" to="/compra/pasajeros">Volver a los pasajeros</ButtonLink>
          </div>
        </form>

        <aside className={`${ui.card} ${s.aside}`} aria-label="Resumen del importe">
          <HoldTimer clock={clock} />
          <h2>Resumen del importe</h2>
          <dl className={s.lines}>
            <SummaryLine label="Pasajeros">{drafts.length}</SummaryLine>
            <SummaryLine label="Tarifas y tasas">{frozen ? formatMoney(frozen) : '—'}</SummaryLine>
            <SummaryLine label="Equipaje adicional">{formatMoney({ currency, total: extras })}</SummaryLine>
          </dl>
          <div className={s.total}><span>Total a pagar</span><span>{total ? formatMoney({ currency, total }) : '—'}</span></div>
        </aside>
      </div>
    </div>
  );
}
