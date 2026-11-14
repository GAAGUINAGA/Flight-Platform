import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { formatDate } from '@flight-platform/format';
import { SearchFlightsOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { CabinClass } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useQuery } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { ButtonLink } from '../components/ui/Button';
import { SelectField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { OfferCard } from '../search/OfferCard';
import { availableCabins, selectOffers, type Offer, type SortBy } from '../search/offers';
import { cabinLabel, CABINS, fromSearchParams, passengersLabel, routeLabel, toSearchInput, validateSearch } from '../search/search-model';
import styles from '../search/search.module.css';

/** Resultados (diseño F12c-0 §3.2): varias ofertas con orden y filtros EN EL CLIENTE (el servicio devuelve hasta 10, sin paginar). */
export function ResultsPage() {
  usePageTitle('Resultados de búsqueda');
  const [params] = useSearchParams(); const navigate = useNavigate();
  const key = params.toString();
  const criteria = useMemo(() => fromSearchParams(new URLSearchParams(key)), [key]);
  const invalid = !criteria || Object.keys(validateSearch(criteria)).length > 0;
  const query = useQuery(SearchFlightsOperation, criteria && !invalid ? { input: toSearchInput(criteria) } : null, key);
  const [sortBy, setSortBy] = useState<SortBy>('price');
  const [directOnly, setDirectOnly] = useState(false);
  const [cabin, setCabin] = useState<CabinClass | null>(criteria?.cabin ?? null);

  if (!criteria || invalid) {
    return (
      <div className={pageClass}>
        <h1>Resultados de búsqueda</h1>
        <Notice kind="warning" title="Esta búsqueda no es válida o ya venció.">
          <p>Revisa el origen, el destino, las fechas y los pasajeros.</p>
          <div className={ui.actions}><ButtonLink size="small" to="/">Modificar búsqueda</ButtonLink></div>
        </Notice>
      </div>
    );
  }

  const choose = (offer: Offer): void => {
    navigate(`/oferta/${encodeURIComponent(offer.offerId)}`, { state: { route: routeLabel(criteria.legs), total: offer.grandTotal, back: `/resultados?${key}` } });
  };
  const offers = query.status === 'success' ? query.data.searchFlights.offers : [];
  const visible = selectOffers(offers, { directOnly, cabin }, sortBy);
  const cabins = availableCabins(offers);

  return (
    <div className={pageClass}>
      <div className={styles.strip}>
        <div className={styles.stripRoute}>
          <strong>{routeLabel(criteria.legs)}</strong>
          <span>{criteria.legs.map((leg) => formatDate(leg.date)).join(' · ')} · {passengersLabel(criteria.passengers)}{criteria.cabin ? ` · ${cabinLabel(criteria.cabin)}` : ''}</span>
        </div>
        <ButtonLink variant="secondary" size="small" to="/">Modificar búsqueda</ButtonLink>
      </div>

      <div className={styles.resultsHead}>
        <div>
          <span className={ui.eyebrow}>Encuentra tu próximo vuelo</span>
          <h1>Elige cómo quieres viajar</h1>
        </div>
        <div className={styles.sort}>
          <SelectField label="Ordenar por" value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
            <option value="price">Menor precio</option>
            <option value="departure">Hora de salida</option>
          </SelectField>
        </div>
      </div>

      {query.status === 'loading' ? <LoadingState phase={query.phase} label="Buscando vuelos" skeletons={3} onRetry={query.reload} /> : null}
      {query.status === 'error' ? <ErrorPanel error={query.error} onRetry={query.reload} fixHref="/" /> : null}
      {query.status === 'success' && offers.length === 0 ? (
        <div className={ui.statePage}>
          <span className={ui.stateIcon}><SearchX size={36} aria-hidden="true" /></span>
          <h2>No hay vuelos para esa fecha</h2>
          <p>Prueba otra fecha u otra ruta.</p>
          <ButtonLink to="/">Modificar búsqueda</ButtonLink>
        </div>
      ) : null}
      {query.status === 'success' && offers.length > 0 ? (
        <div className={styles.layout}>
          <aside className={`${ui.card} ${styles.filters}`} aria-label="Filtros">
            <h2>Filtra tu búsqueda</h2>
            <label className={styles.check}><input type="checkbox" checked={directOnly} onChange={(event) => setDirectOnly(event.target.checked)} />Solo vuelos directos</label>
            <SelectField label="Cabina" value={cabin ?? ''} onChange={(event) => setCabin((event.target.value || null) as CabinClass | null)}>
              <option value="">Cualquiera</option>
              {CABINS.filter((entry) => cabins.includes(entry.value) || entry.value === cabin).map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </SelectField>
            <p className={ui.hint}>Horas en la hora local de cada aeropuerto. Precios en USD.</p>
          </aside>
          <section aria-labelledby="ofertas-title">
            <h2 id="ofertas-title" className={ui.srOnly}>Ofertas</h2>
            <p className={ui.hint} role="status">{visible.length === offers.length ? `${offers.length} ${offers.length === 1 ? 'oferta' : 'ofertas'}` : `${visible.length} de ${offers.length} ofertas con estos filtros`}</p>
            {visible.length === 0
              ? <Notice kind="info" title="Ninguna oferta cumple estos filtros."><p>Quita algún filtro para ver más opciones.</p></Notice>
              : <ul className={styles.list}>{visible.map((offer) => <li key={offer.offerId}><OfferCard offer={offer} cabin={cabin} onChoose={choose} /></li>)}</ul>}
          </section>
        </div>
      ) : null}
    </div>
  );
}
