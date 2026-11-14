import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { HoldOfferOperation, ReleaseHoldOperation, SeatMapOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { HoldOfferInput } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useQuery, useServices, usePurchase } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { AppError, toAppError } from '../data/errors';
import { newCorrelationId } from '../data/identity';
import { formatMoney } from '@flight-platform/format';
import { FlightPath } from '../search/OfferCard';
import { cabinLabel, routeLabel } from '../search/search-model';
import { runIntent } from './intent';
import { needsSeat, typeLabel } from './passenger-rules';
import { estimateTotal, optionFor, priceOfType, type Itinerary } from './pricing';
import { seatedCount } from './purchase-store';
import { SeatLegend, SeatMap } from './SeatMap';
import { isSelectable, type MapSeat } from './seat-map';
import { RequireSession, Stepper } from './Shared';
import s from './purchase.module.css';

/** Detalle de la oferta y mapa de asientos (diseño F12c-0 §3.5): tarifa por tramo, un asiento por pasajero con asiento y creación del hold. */
export function OfferPage() {
  return <RequireSession><OfferScreen /></RequireSession>;
}

function OfferScreen() {
  usePageTitle('Elige tus asientos');
  const { offerId = '' } = useParams(); const navigate = useNavigate();
  const { client } = useServices(); const { state, store } = usePurchase();
  const offer = state.offer?.offerId === offerId ? state.offer : null;
  const back = state.back ?? '/';
  const [segmentIndex, setSegmentIndex] = useState(0); const [paxIndex, setPaxIndex] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<AppError | null>(null);
  const [missing, setMissing] = useState(false);

  const segments = useMemo(() => (offer ? offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => ({ itinerary, segment }))) : []), [offer]);
  const current = segments[Math.min(segmentIndex, Math.max(0, segments.length - 1))];
  const seated = state.drafts.filter((draft) => needsSeat(draft.passengerType));
  const seatCount = seatedCount(state.counts);
  const seatQuery = useQuery(SeatMapOperation, offer && current ? { offerId, segmentId: current.segment.segmentId } : null, `${offerId}:${current?.segment.segmentId ?? ''}:${refresh}`);
  const locked = state.hold !== null;
  const cabinWanted = current ? state.selections[current.itinerary.itineraryId]?.cabinClass : undefined;
  const cabin = seatQuery.status === 'success' ? seatQuery.data.seatMap.cabins.find((entry) => entry.cabinClass === cabinWanted) : undefined;
  const rowSeats = current ? (state.seats[current.segment.segmentId] ?? []) : [];

  // Tras refrescar el mapa, un asiento elegido que ya no está libre se suelta (el resto de la selección se conserva).
  useEffect(() => {
    if (!cabin || !current || locked) return;
    const free = new Map(cabin.rows.flatMap((row) => row.seats).map((seat) => [seat.seatNumber, isSelectable(seat)]));
    for (const seat of state.seats[current.segment.segmentId] ?? []) if (seat && free.get(seat) !== true) store.clearSeat(current.segment.segmentId, seat);
  }, [cabin, current, locked, state.seats, store]);

  if (!offer) {
    return (
      <div className={pageClass}>
        <div className={ui.statePage}>
          <h1>Tu selección ya no está disponible</h1>
          <p>Vuelve a los resultados para elegir de nuevo: conservamos tus criterios de búsqueda.</p>
          <ButtonLink to={back}>Volver a los resultados</ButtonLink>
        </div>
      </div>
    );
  }

  const chosen: Record<string, string> = {};
  rowSeats.forEach((seat, index) => { if (seat) chosen[seat] = `Pasajero ${index + 1}`; });
  const estimate = estimateTotal(offer, state.selections, state.counts);
  const complete = segments.every(({ segment }) => seated.every((_, index) => Boolean((state.seats[segment.segmentId] ?? [])[index])));

  const onSelect = (seat: MapSeat): void => {
    if (!current || locked) return;
    if (chosen[seat.seatNumber]) { store.clearSeat(current.segment.segmentId, seat.seatNumber); return; }
    if (seated.length === 0) return;
    store.setSeat(current.segment.segmentId, paxIndex, seat.seatNumber);
    const taken = new Set([...rowSeats.keys()].filter((i) => rowSeats[i]).concat(paxIndex));
    const next = seated.findIndex((_, index) => !taken.has(index)); if (next >= 0) setPaxIndex(next);
  };

  const hold = async (): Promise<void> => {
    if (state.hold) { navigate('/compra/pasajeros'); return; }
    if (!complete) { setMissing(true); return; }
    setMissing(false); setError(null); setBusy(true);
    const input: HoldOfferInput = {
      offerId,
      selections: offer.itineraries.map((itinerary) => ({ itineraryId: itinerary.itineraryId, cabinClass: state.selections[itinerary.itineraryId].cabinClass, fareBrand: state.selections[itinerary.itineraryId].fareBrand })),
      passengers: { ...state.counts },
      seats: segments.flatMap(({ segment }) => (state.seats[segment.segmentId] ?? []).slice(0, seatCount).filter(Boolean).map((seatNumber) => ({ segmentId: segment.segmentId, seatNumber })))
    };
    const signature = JSON.stringify(input);
    try {
      const result = await runIntent(store.intents, 'hold', signature, (intent) => client.execute(HoldOfferOperation, { input, idempotencyKey: intent.idempotencyKey }, { correlationId: intent.correlationId }), store.correlationId(newCorrelationId));
      store.setHold({ holdId: result.holdOffer.holdId, signature });
      navigate('/compra/pasajeros');
    } catch (failure) { setError(toAppError(failure)); } finally { setBusy(false); }
  };

  const change = async (): Promise<void> => {
    const holdId = state.hold?.holdId; setBusy(true);
    try { if (holdId) await client.execute(ReleaseHoldOperation, { holdId }, { correlationId: store.correlationId(newCorrelationId) }); } catch { /* si ya venció o se liberó, da igual */ }
    store.setHold(null); store.intents.clear(); setRefresh((value) => value + 1); setBusy(false);
  };

  return (
    <div className={pageClass}>
      <Stepper current={1} />
      <h1 className={s.heading}>Elige tu tarifa y tus asientos</h1>
      <p className={s.lead}>{routeLabel(offer.itineraries.flatMap((itinerary) => [{ origin: itinerary.segments[0].departure.iataCode, destination: itinerary.segments[itinerary.segments.length - 1].arrival.iataCode, date: '' }]))} · {offer.airline.name ?? offer.airline.code}</p>

      <div className={s.twoCol}>
        <div className={s.stack}>
          {offer.itineraries.map((itinerary, index) => <FareSection key={itinerary.itineraryId} itinerary={itinerary} index={index} count={offer.itineraries.length} disabled={locked} />)}

          <section className={ui.card} aria-labelledby="asientos-title">
            <h2 id="asientos-title">Asientos</h2>
            {locked ? (
              <Notice kind="success" title="Tus asientos están reservados.">
                <p>Continúa con los datos de los pasajeros, o cámbialos si lo prefieres.</p>
                <div className={ui.actions}><Button size="small" variant="secondary" loading={busy} onClick={() => void change()}>Cambiar asientos o tarifa</Button></div>
              </Notice>
            ) : null}
            {seatCount === 0 ? <p>Este viaje no incluye asientos por elegir.</p> : null}
            {segments.length > 1 ? (
              <div className={s.segmentTabs} role="group" aria-label="Tramo del viaje">
                {segments.map(({ segment }, index) => (
                  <Button key={segment.segmentId} size="small" variant={index === segmentIndex ? 'primary' : 'secondary'} aria-pressed={index === segmentIndex} onClick={() => setSegmentIndex(index)}>
                    {segment.flightNumber} · {segment.departure.iataCode} → {segment.arrival.iataCode}
                  </Button>
                ))}
              </div>
            ) : null}
            {seated.length > 0 ? (
              <fieldset className={s.paxTabs}>
                <legend className={s.legend2}>¿Para quién eliges el asiento?</legend>
                {seated.map((draft, index) => (
                  <button key={draft.passengerId} type="button" className={`${s.paxTab} ${index === paxIndex ? s.paxTabActive : ''}`} aria-pressed={index === paxIndex} onClick={() => setPaxIndex(index)} disabled={locked}>
                    <span>Pasajero {index + 1} · {typeLabel(draft.passengerType)}</span>
                    <span className={s.paxSeat}>{rowSeats[index] ? `Asiento ${rowSeats[index]}` : 'Sin asiento'}</span>
                  </button>
                ))}
              </fieldset>
            ) : null}
            {state.counts.infants > 0 ? <p className={s.muted}>Los infantes viajan en brazos de un adulto y no ocupan asiento.</p> : null}
            <SeatLegend />
            {seatQuery.status === 'loading' ? <LoadingState phase={seatQuery.phase} label="Cargando el mapa de asientos" onRetry={seatQuery.reload} /> : null}
            {seatQuery.status === 'error' ? <ErrorPanel error={seatQuery.error} onRetry={seatQuery.reload} searchHref={back} /> : null}
            {seatQuery.status === 'success' && !cabin ? <Notice kind="info" title="No hay mapa de asientos para esta cabina."><p>Elige otra tarifa o continúa: te asignaremos el asiento.</p></Notice> : null}
            {cabin ? <SeatMap cabin={cabin} chosen={chosen} onSelect={onSelect} /> : null}
          </section>
        </div>

        <aside className={`${ui.card} ${s.aside}`} aria-label="Resumen de tu viaje">
          <h2>Tu viaje</h2>
          <dl className={s.lines}>
            {offer.itineraries.map((itinerary) => {
              const option = optionFor(itinerary, state.selections[itinerary.itineraryId]);
              return <div key={itinerary.itineraryId} className={s.line}><dt>{itinerary.segments.map((segment) => segment.flightNumber).join(', ')}</dt><dd>{option ? `${cabinLabel(option.cabinClass)} ${option.fareBrand}` : '—'}</dd></div>;
            })}
            <div className={s.line}><dt>Pasajeros</dt><dd>{state.drafts.length}</dd></div>
            <div className={s.line}><dt>Asientos elegidos</dt><dd>{segments.length === 0 ? 0 : Math.min(...segments.map(({ segment }) => (state.seats[segment.segmentId] ?? []).filter(Boolean).length))} de {seatCount}</dd></div>
          </dl>
          <div className={s.total}><span>Total estimado</span><span>{estimate ? formatMoney(estimate) : formatMoney(offer.grandTotal)}</span></div>
          <p className={s.muted}>El total final se confirma al reservar tus asientos. Importes en {offer.grandTotal.currency}.</p>
          {missing ? <Notice kind="warning" title="Elige un asiento para cada pasajero en todos los tramos."><p>Faltan asientos por elegir.</p></Notice> : null}
          {error ? <ErrorPanel error={error} onRetry={() => void hold()} searchHref={back} onRefreshSeats={() => { setError(null); setRefresh((value) => value + 1); }} /> : null}
          <Button block loading={busy} onClick={() => void hold()}>Continuar a datos de pasajeros</Button>
          <ButtonLink block variant="secondary" to={back}>Volver a los resultados</ButtonLink>
        </aside>
      </div>
    </div>
  );
}

function FareSection({ itinerary, index, count, disabled }: { itinerary: Itinerary; index: number; count: number; disabled: boolean }) {
  const { state, store } = usePurchase();
  const selection = state.selections[itinerary.itineraryId];
  return (
    <section className={ui.card} aria-labelledby={`tarifa-${itinerary.itineraryId}`}>
      <h2 id={`tarifa-${itinerary.itineraryId}`}>{count > 1 ? `Tramo ${index + 1}: ` : ''}Tarifa</h2>
      <FlightPath itinerary={itinerary} />
      <fieldset className={s.fares} disabled={disabled}>
        <legend className={ui.srOnly}>Elige una tarifa</legend>
        {itinerary.pricingOptions.map((option) => {
          const price = priceOfType(option, 'ADULT'); const checked = selection?.cabinClass === option.cabinClass && selection.fareBrand === option.fareBrand;
          return (
            <label key={`${option.cabinClass}-${option.fareBrand}`} className={s.fare}>
              <input type="radio" name={`tarifa-${itinerary.itineraryId}`} checked={checked} onChange={() => store.selectFare(itinerary.itineraryId, { cabinClass: option.cabinClass, fareBrand: option.fareBrand })} />
              <span className={s.fareName}>{cabinLabel(option.cabinClass)} · {option.fareBrand}</span>
              <span className={s.farePrice}>{price ? `${formatMoney({ currency: state.offer?.grandTotal.currency ?? 'USD', total: price })} por adulto` : 'Consultar precio'}</span>
              <ul className={s.fareRules}>
                <li>{option.fareRules.isRefundable ? 'Reembolsable' : 'No reembolsable'}</li>
                <li>{option.fareRules.isChangeable ? 'Permite cambios' : 'Sin cambios'}</li>
                <li>{(option.baggageAllowance.checkedBaggageIncluded ?? 0) > 0 ? `${option.baggageAllowance.checkedBaggageIncluded} maleta facturada incluida` : 'Sin maleta facturada incluida'}</li>
                <li>{option.availableSeats} {option.availableSeats === 1 ? 'asiento disponible' : 'asientos disponibles'}</li>
              </ul>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
