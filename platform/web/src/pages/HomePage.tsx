import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Luggage, MapPin, Plane } from 'lucide-react';
import { brand, featuredOrigins } from '@flight-platform/brand';
import { cityOf } from '@flight-platform/format';
import { usePageTitle } from '../app/page';
import { photoUrl } from '../brand/assets';
import { TextButton } from '../components/ui/Button';
import { SelectField } from '../components/ui/Field';
import ui from '../components/ui/ui.module.css';
import { SearchForm, type SearchFormHandle } from '../search/SearchForm';
import { toSearchParams, type SearchCriteria } from '../search/search-model';
import styles from '../search/search.module.css';

const ICONS = { luggage: Luggage, 'map-pin': MapPin, plane: Plane } as const;

/** Inicio (diseño F12c-0 §3.1): buscador sobre el hero, rutas destacadas por origen (sin precios) y experiencia. Contenido estático: no espera al backend. */
export function HomePage() {
  usePageTitle('Buscar vuelos');
  const navigate = useNavigate();
  const form = useRef<SearchFormHandle>(null);
  const origins = featuredOrigins();
  const [origin, setOrigin] = useState(origins[0]);
  const hero = brand.photos[brand.hero.photo];
  const search = (criteria: SearchCriteria): void => { navigate(`/resultados?${toSearchParams(criteria).toString()}`); };

  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <img className={styles.heroImage} src={photoUrl(brand.hero.photo)} alt="" />
        <div className={styles.heroScrim} />
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <h1 id="hero-title" className={styles.heroTitle}>{brand.hero.title}</h1>
            <p className={styles.heroSubtitle}>{brand.hero.subtitle}</p>
          </div>
          <SearchForm ref={form} onSearch={search} />
        </div>
      </section>

      <div className={ui.container}>
        <section className={styles.section} aria-labelledby="destacados-title">
          <div className={styles.sectionHead}>
            <div>
              <span className={ui.eyebrow}>El próximo destino lo eliges tú</span>
              <h2 id="destacados-title">Destinos destacados</h2>
            </div>
            <div className={styles.originPicker}>
              <SelectField label="Destinos destacados desde" value={origin} onChange={(event) => setOrigin(event.target.value)}>
                {origins.map((iata) => <option key={iata} value={iata}>{cityOf(iata)}</option>)}
              </SelectField>
            </div>
          </div>
          <ul className={styles.grid4}>
            {(brand.featuredRoutes[origin] ?? []).map((route) => {
              const photo = brand.photos[route.photo];
              return (
                <li key={route.destination}>
                  <article className={styles.routeCard}>
                    <img className={styles.routeImage} src={photoUrl(route.photo)} alt={photo.alt} loading="lazy" />
                    <div className={styles.routeInfo}>
                      <span><span className={ui.tag}>{route.tag}</span></span>
                      <h3>{cityOf(route.destination)}</h3>
                      <p>{route.blurb}</p>
                      {/* El nombre accesible contiene el texto visible y añade el destino (los cuatro botones no se llaman igual). */}
                      <TextButton className={styles.routeAction} onClick={() => form.current?.prefill(origin, route.destination)}>
                        Buscar desde {cityOf(origin)}{' '}<span className={ui.srOnly}>a {cityOf(route.destination)}</span><ArrowRight size={16} aria-hidden="true" />
                      </TextButton>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
          <p className={`${ui.hint} ${ui.muted}`}>Cada tarjeta abre el buscador con la ruta elegida; elige la fecha para ver vuelos y precios. Foto del encabezado: {hero.credit.author}, {hero.credit.license}.</p>
        </section>

        <section className={styles.section} aria-labelledby="experiencia-title">
          <h2 id="experiencia-title">Te acompañamos en cada etapa</h2>
          <ul className={styles.grid3}>
            {brand.experience.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <li key={item.title} className={`${ui.card} ${styles.experience}`}>
                  <Icon size={32} aria-hidden="true" />
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <div className={styles.section} />
    </>
  );
}
