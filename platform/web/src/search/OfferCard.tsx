import { Plane } from 'lucide-react';
import { cityOf, dayOffsetLabel, formatDuration, formatLocalDate, formatLocalTime, formatMoney, zoneLabel } from '@flight-platform/format';
import type { CabinClass, ItineraryFieldsFragment } from '@flight-platform/graphql-schema/generated/types';
import { Button } from '../components/ui/Button';
import ui from '../components/ui/ui.module.css';
import { adultPrice, cheapestOption, stopsLabel, type Offer } from './offers';
import { cabinLabel } from './search-model';
import styles from './search.module.css';

/** Un tramo: salida y llegada EN LA HORA LOCAL DE CADA AEROPUERTO, con «+1» si llega otro día, duración y escalas. */
export function FlightPath({ itinerary }: { itinerary: ItineraryFieldsFragment }) {
  const first = itinerary.segments[0]; const last = itinerary.segments[itinerary.segments.length - 1];
  if (!first || !last) return null;
  const origin = first.departure.iataCode; const destination = last.arrival.iataCode;
  const plus = dayOffsetLabel(first.departure.at, origin, last.arrival.at, destination);
  const via = itinerary.segments.slice(0, -1).map((segment) => segment.arrival.iataCode).join(', ');
  return (
    <div className={styles.path}>
      <div className={styles.endpoint}>
        <span className={styles.time}>{formatLocalTime(first.departure.at, origin)}</span>
        <span className={styles.code}>{origin} · {cityOf(origin)}</span>
        <span className={styles.zone}>{zoneLabel(origin)}</span>
      </div>
      <div className={styles.middle}>
        <span>{formatDuration(itinerary.totalDurationMinutes)}</span>
        <span className={styles.line}><Plane size={16} aria-hidden="true" /></span>
        <span>{stopsLabel(itinerary.stopsCount)}{via ? ` · ${via}` : ''}</span>
      </div>
      <div className={`${styles.endpoint} ${styles.endpointRight}`}>
        <span className={styles.time}>
          {formatLocalTime(last.arrival.at, destination)}
          {plus ? <span className={styles.plus} title="Llega otro día (hora local del destino)">{plus}<span className={ui.srOnly}> día respecto de la salida</span></span> : null}
        </span>
        <span className={styles.code}>{destination} · {cityOf(destination)}</span>
        <span className={styles.zone}>{zoneLabel(destination)}</span>
      </div>
    </div>
  );
}

/** Tarjeta de una oferta: todos sus tramos, la tarifa más económica de cada uno (en la cabina filtrada, si hay) y el total. */
export function OfferCard({ offer, cabin, onChoose }: { offer: Offer; cabin: CabinClass | null; onChoose: (offer: Offer) => void }) {
  const flights = offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => segment.flightNumber)).join(', ');
  return (
    <article className={`${ui.card} ${styles.offer}`} aria-label={`Oferta ${flights}`}>
      <div className={styles.itineraries}>
        {offer.itineraries.map((itinerary, index) => {
          const option = cheapestOption(itinerary, cabin) ?? cheapestOption(itinerary);
          const price = option ? adultPrice(option) : null; const first = itinerary.segments[0];
          return (
            <div key={itinerary.itineraryId} className={styles.itinerary}>
              <div className={styles.itineraryMeta}>
                {offer.itineraries.length > 1 ? <span className={ui.tag}>Tramo {index + 1}</span> : null}
                {first ? <span>{formatLocalDate(first.departure.at, first.departure.iataCode, { weekday: true })}</span> : null}
                <span>{offer.airline.name ?? offer.airline.code ?? ''} · {itinerary.segments.map((segment) => segment.flightNumber).join(', ')}</span>
              </div>
              <FlightPath itinerary={itinerary} />
              {option ? (
                <div className={styles.itineraryMeta}>
                  <span className={ui.tag}>{cabinLabel(option.cabinClass)} · {option.fareBrand}</span>
                  {price ? <span>desde {formatMoney(price)} por adulto</span> : null}
                  <span>{option.availableSeats} {option.availableSeats === 1 ? 'asiento disponible' : 'asientos disponibles'}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={styles.price}>
        <small>Total desde, todos los pasajeros</small>
        <span className={styles.amount}>{formatMoney(offer.grandTotal)}</span>
        {offer.grandTotal.taxes ? <small>Tasas incluidas</small> : null}
        <Button size="small" onClick={() => onChoose(offer)} aria-label={`Elegir la oferta ${flights} por ${formatMoney(offer.grandTotal)}`}>Elegir</Button>
      </div>
    </article>
  );
}
