import { useState } from 'react';
import { formatMoney, isIsoDate, todayAt } from '@flight-platform/format';
import { ConfirmDateChangeOperation, SearchDateChangeOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { SearchDateChangeQuery } from '@flight-platform/graphql-schema/generated/types';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { TextField, SelectField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { newCorrelationId } from '../data/identity';
import { toAppError, type AppError } from '../data/errors';
import { toCents } from '../purchase/amounts';
import { paymentReference } from '../purchase/intent';
import { whenAt } from '../purchase/Shared';
import { useAction } from './useAction';
import type { Booking } from './useBooking';
import s from '../purchase/purchase.module.css';

type Offer = SearchDateChangeQuery['searchDateChange'][number];

/** Postventa · Fecha (§3.11): elegir el tramo y la nueva fecha (local del origen) → buscar → ver la diferencia a pagar → confirmar. */
export function DateTab({ booking, onDone, searchHref }: { booking: Booking; onDone: (outcome: 'COMPLETED' | 'PENDING') => void; searchHref: string }) {
  const { client } = useServices(); const action = useAction();
  const itineraries = booking.itineraries ?? [];
  const [itineraryId, setItineraryId] = useState(itineraries[0]?.itineraryId ?? ''); const [date, setDate] = useState('');
  const [offers, setOffers] = useState<Offer[] | null>(null); const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState<AppError | null>(null);
  const [picked, setPicked] = useState<Offer | null>(null); const [fieldError, setFieldError] = useState<string | undefined>();
  const origin = itineraries.find((itinerary) => itinerary.itineraryId === itineraryId)?.segments[0]?.departure.iataCode ?? '';
  const currency = booking.grandTotal.currency;

  const search = async (): Promise<void> => {
    const minimum = origin ? todayAt(origin) : '';
    if (!isIsoDate(date)) { setFieldError('Elige la nueva fecha de salida.'); return; }
    if (minimum && date < minimum) { setFieldError('La fecha ya pasó en el aeropuerto de origen.'); return; }
    setFieldError(undefined); setSearching(true); setSearchError(null); setPicked(null); setOffers(null);
    try {
      const data = await client.execute(SearchDateChangeOperation, { bookingId: booking.bookingId, changes: [{ itineraryId, newDepartureDate: date }] }, { correlationId: newCorrelationId() });
      setOffers(data.searchDateChange);
    } catch (failure) { setSearchError(toAppError(failure)); } finally { setSearching(false); }
  };

  const toPay = (offer: Offer): string => offer.priceDifference.totalToPay ?? '0.00';
  const confirm = async (offer: Offer): Promise<void> => {
    const payable = (toCents(toPay(offer)) ?? 0) > 0;
    const result = await action.run('date-change', JSON.stringify({ id: offer.changeOfferId }), (intent) => client.execute(ConfirmDateChangeOperation, {
      input: { bookingId: booking.bookingId, changeOfferId: offer.changeOfferId, ...(payable ? { paymentReference: paymentReference('ok', intent.nonce) } : {}) }, idempotencyKey: intent.idempotencyKey
    }, { correlationId: intent.correlationId }));
    if (result) onDone(result.confirmDateChange.outcome);
  };

  return (
    <div className={s.stack}>
      <form className={`${ui.card} ${s.fields}`} noValidate onSubmit={(event) => { event.preventDefault(); void search(); }} aria-label="Buscar nueva fecha">
        <SelectField label="Tramo a cambiar" value={itineraryId} onChange={(event) => { setItineraryId(event.target.value); setOffers(null); setPicked(null); }}>
          {itineraries.map((itinerary, index) => <option key={itinerary.itineraryId} value={itinerary.itineraryId}>{`Tramo ${index + 1}: ${itinerary.segments[0]?.departure.iataCode} → ${itinerary.segments[itinerary.segments.length - 1]?.arrival.iataCode}`}</option>)}
        </SelectField>
        <TextField label="Nueva fecha de salida" type="date" value={date} min={origin ? todayAt(origin) : undefined} onChange={(event) => { setDate(event.target.value); setFieldError(undefined); }} error={fieldError} hint={origin ? `Fecha local de ${origin}.` : undefined} />
        <div className={s.row}><Button type="submit" loading={searching}>Buscar vuelos</Button></div>
      </form>

      {searching ? <LoadingState phase="normal" label="Buscando vuelos para esa fecha" /> : null}
      {searchError ? <ErrorPanel error={searchError} onRetry={() => void search()} searchHref={searchHref} /> : null}
      {offers && offers.length === 0 ? <Notice kind="info" title="No hay vuelos para esa fecha."><p>Prueba con otra fecha.</p></Notice> : null}
      {offers && offers.length > 0 ? (
        <ul className={s.list} aria-label="Opciones de cambio">
          {offers.map((offer) => (
            <li key={offer.changeOfferId}>
              <article className={`${ui.card} ${s.offerRow}`} aria-label={`Opción ${offer.segments.map((segment) => segment.flightNumber).join(', ')}`}>
                <div className={s.stackSmall}>
                  {offer.segments.map((segment) => <span key={segment.segmentId}><strong>{segment.flightNumber}</strong> · {segment.departure.iataCode} {whenAt(segment.departure.at, segment.departure.iataCode)} → {segment.arrival.iataCode} {whenAt(segment.arrival.at, segment.arrival.iataCode)}</span>)}
                  <dl className={s.lines}>
                    <div className={s.line}><dt>Diferencia de tarifa</dt><dd>{formatMoney({ currency, total: offer.priceDifference.fareDifference ?? '0.00' })}</dd></div>
                    <div className={s.line}><dt>Diferencia de tasas</dt><dd>{formatMoney({ currency, total: offer.priceDifference.taxDifference ?? '0.00' })}</dd></div>
                    <div className={s.line}><dt>Cargo por cambio</dt><dd>{formatMoney({ currency, total: offer.priceDifference.changeFee ?? '0.00' })}</dd></div>
                  </dl>
                  <div className={s.total}><span>Total a pagar</span><span>{formatMoney({ currency, total: toPay(offer) })}</span></div>
                </div>
                <Button variant="secondary" onClick={() => { action.clearError(); setPicked(offer); }}>Elegir esta opción</Button>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      {picked ? (
        <section className={`${ui.card} ${s.stackSmall}`} aria-label="Confirmar el cambio de fecha">
          <h3>Confirma el cambio de fecha</h3>
          <p>{(toCents(toPay(picked)) ?? 0) > 0 ? <>Pagarás <strong>{formatMoney({ currency, total: toPay(picked) })}</strong> por el cambio.</> : 'Este cambio no tiene costo adicional.'} La oferta es válida hasta las {formatLocal(picked.expiresAt, origin)}. Una vez confirmado, tus boletos se vuelven a emitir con la nueva fecha.</p>
          {action.error ? <ErrorPanel error={action.error} onRetry={() => void confirm(picked)} onRetryPayment={action.clearError} searchHref={searchHref} /> : null}
          <div className={s.row}><Button loading={action.busy} onClick={() => void confirm(picked)}>Confirmar el cambio</Button><Button variant="secondary" onClick={() => setPicked(null)}>Volver</Button></div>
        </section>
      ) : null}
    </div>
  );
}

function formatLocal(instant: string, iata: string): string { return whenAt(instant, iata); }
