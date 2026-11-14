import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Plane, Plus, Trash2 } from 'lucide-react';
import { addDays, AIRPORTS, todayAt } from '@flight-platform/format';
import type { CabinClass } from '@flight-platform/graphql-schema/generated/types';
import { Button, TextButton } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import ui from '../components/ui/ui.module.css';
import { CABINS, legsForTrip, MAX_LEGS, MAX_PASSENGERS, TRIPS, validateSearch, type FieldErrors, type Leg, type Passengers, type SearchCriteria, type TripType } from './search-model';
import styles from './search.module.css';

export interface SearchFormHandle { /** Prellena origen y destino (tarjeta de ruta destacada) y lleva el foco a la fecha. No lanza la búsqueda. */ prefill(origin: string, destination: string): void }

export function defaultCriteria(now: Date = new Date()): SearchCriteria {
  const date = addDays(todayAt('UIO', now), 14);
  return { trip: 'idavuelta', legs: [{ origin: 'UIO', destination: 'GPS', date }, { origin: 'GPS', destination: 'UIO', date: addDays(date, 7) }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 }, cabin: null };
}

const PASSENGER_FIELDS: Array<{ key: keyof Passengers; label: string; hint: string; min: number }> = [
  { key: 'adults', label: 'Adultos', hint: 'Desde 18 años', min: 1 },
  { key: 'youths', label: 'Jóvenes', hint: '12 a 17 años', min: 0 },
  { key: 'children', label: 'Niños', hint: '2 a 11 años', min: 0 },
  { key: 'infants', label: 'Infantes', hint: 'Menores de 2, sin asiento', min: 0 }
];

/** Buscador de vuelos: solo ida, ida y vuelta y multidestino (hasta 6 tramos). Los aeropuertos salen de la tabla única. */
export const SearchForm = forwardRef<SearchFormHandle, { initial?: SearchCriteria; onSearch: (criteria: SearchCriteria) => void; now?: Date; submitLabel?: string }>(
  function SearchForm({ initial, onSearch, now, submitLabel = 'Buscar vuelos' }, ref) {
    const [criteria, setCriteria] = useState<SearchCriteria>(() => initial ?? defaultCriteria(now));
    const [errors, setErrors] = useState<FieldErrors>({});
    const form = useRef<HTMLFormElement>(null);
    const { trip, legs, passengers } = criteria;

    const setLegs = (next: Leg[]): void => setCriteria((current) => ({ ...current, legs: next }));
    const updateLeg = (index: number, patch: Partial<Leg>): void => {
      const next = legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg));
      // En ida y vuelta el regreso es siempre el tramo inverso.
      if (trip === 'idavuelta' && index === 0) next[1] = { ...next[1], origin: next[0].destination, destination: next[0].origin };
      setLegs(next);
    };
    const setTrip = (value: TripType): void => { setErrors({}); setCriteria((current) => ({ ...current, trip: value, legs: legsForTrip(value, current.legs) })); };
    const swap = (): void => updateLeg(0, { origin: legs[0].destination, destination: legs[0].origin });

    useImperativeHandle(ref, () => ({
      prefill(origin, destination) {
        setErrors({});
        setCriteria((current) => {
          const first = { ...current.legs[0], origin, destination };
          const rest = current.trip === 'idavuelta' ? [{ ...current.legs[1], origin: destination, destination: origin }] : current.legs.slice(1);
          return { ...current, legs: [first, ...rest] };
        });
        form.current?.scrollIntoView?.({ block: 'center' });
        // La primera fecha se localiza por id: existe en los tres tipos de viaje.
        form.current?.querySelector<HTMLInputElement>('#buscador-fecha-ida')?.focus();
      }
    }), []);

    const submit = (event: FormEvent): void => {
      event.preventDefault();
      const found = validateSearch(criteria, now);
      setErrors(found);
      const firstKey = Object.keys(found)[0];
      if (firstKey) { form.current?.querySelector<HTMLElement>(`[data-field="${firstKey}"] input, [data-field="${firstKey}"] select`)?.focus(); return; }
      onSearch(criteria);
    };

    const airportOptions = (placeholder: string) => (
      <>
        <option value="">{placeholder}</option>
        {AIRPORTS.map((airport) => <option key={airport.iata} value={airport.iata}>{airport.city} ({airport.iata})</option>)}
      </>
    );
    const minDate = (index: number): string => {
      const today = legs[index].origin ? todayAt(legs[index].origin, now) : todayAt('UIO', now);
      const previous = index > 0 ? legs[index - 1].date : '';
      return previous && previous > today ? previous : today;
    };
    const total = passengers.adults + passengers.youths + passengers.children + passengers.infants;

    return (
      <form className={styles.form} onSubmit={submit} noValidate ref={form} aria-label="Buscar vuelos">
        <fieldset className={styles.trips}>
          <legend className={ui.srOnly}>Tipo de viaje</legend>
          {TRIPS.map((option) => (
            <label key={option.value} className={`${styles.pill} ${trip === option.value ? styles.pillSelected : ''}`}>
              <input type="radio" name="tipo" value={option.value} checked={trip === option.value} onChange={() => setTrip(option.value)} />
              {option.label}
            </label>
          ))}
        </fieldset>

        {trip !== 'multi' ? (
          <div className={styles.route}>
            <div data-field="legs.0.origin" className={styles.grow}><SelectField label="Desde" value={legs[0].origin} onChange={(event) => updateLeg(0, { origin: event.target.value })} error={errors['legs.0.origin']}>{airportOptions('Elige el origen')}</SelectField></div>
            <button type="button" className={styles.swap} onClick={swap} aria-label="Intercambiar origen y destino"><ArrowLeftRight size={18} aria-hidden="true" /></button>
            <div data-field="legs.0.destination" className={styles.grow}><SelectField label="Hacia" value={legs[0].destination} onChange={(event) => updateLeg(0, { destination: event.target.value })} error={errors['legs.0.destination']}>{airportOptions('Elige el destino')}</SelectField></div>
            <div data-field="legs.0.date"><TextField label="Ida" type="date" value={legs[0].date} min={minDate(0)} onChange={(event) => updateLeg(0, { date: event.target.value })} error={errors['legs.0.date']} id="buscador-fecha-ida" /></div>
            {trip === 'idavuelta' ? <div data-field="legs.1.date"><TextField label="Vuelta" type="date" value={legs[1]?.date ?? ''} min={minDate(1)} onChange={(event) => updateLeg(1, { date: event.target.value })} error={errors['legs.1.date']} /></div> : null}
          </div>
        ) : (
          <div className={styles.legs}>
            {legs.map((leg, index) => (
              <fieldset key={index} className={styles.leg}>
                <legend className={styles.legTitle}>Tramo {index + 1}</legend>
                <div data-field={`legs.${index}.origin`} className={styles.grow}><SelectField label="Desde" value={leg.origin} onChange={(event) => updateLeg(index, { origin: event.target.value })} error={errors[`legs.${index}.origin`]}>{airportOptions('Elige el origen')}</SelectField></div>
                <div data-field={`legs.${index}.destination`} className={styles.grow}><SelectField label="Hacia" value={leg.destination} onChange={(event) => updateLeg(index, { destination: event.target.value })} error={errors[`legs.${index}.destination`]}>{airportOptions('Elige el destino')}</SelectField></div>
                <div data-field={`legs.${index}.date`}><TextField label="Fecha" type="date" value={leg.date} min={minDate(index)} onChange={(event) => updateLeg(index, { date: event.target.value })} error={errors[`legs.${index}.date`]} id={index === 0 ? 'buscador-fecha-ida' : undefined} /></div>
                {legs.length > 2 ? <button type="button" className={styles.remove} onClick={() => setLegs(legs.filter((_, i) => i !== index))} aria-label={`Quitar el tramo ${index + 1}`}><Trash2 size={18} aria-hidden="true" /></button> : null}
              </fieldset>
            ))}
            {legs.length < MAX_LEGS ? <TextButton onClick={() => setLegs([...legs, { origin: legs[legs.length - 1].destination, destination: '', date: '' }])}><Plus size={16} aria-hidden="true" />Agregar tramo</TextButton> : <p className={ui.hint}>Máximo {MAX_LEGS} tramos.</p>}
          </div>
        )}

        <fieldset className={styles.passengers} data-field="passengers">
          <legend className={styles.legTitle}>Pasajeros y cabina</legend>
          {PASSENGER_FIELDS.map((field) => (
            <TextField key={field.key} label={field.label} hint={field.hint} type="number" inputMode="numeric" min={field.min} max={MAX_PASSENGERS} value={passengers[field.key]}
              onChange={(event) => setCriteria((current) => ({ ...current, passengers: { ...current.passengers, [field.key]: Math.max(0, Math.trunc(Number(event.target.value) || 0)) } }))} />
          ))}
          <SelectField label="Cabina" hint="Filtra los resultados" value={criteria.cabin ?? ''} onChange={(event) => setCriteria((current) => ({ ...current, cabin: (event.target.value || null) as CabinClass | null }))}>
            <option value="">Cualquiera</option>
            {CABINS.map((cabin) => <option key={cabin.value} value={cabin.value}>{cabin.label}</option>)}
          </SelectField>
        </fieldset>
        {errors.passengers ? <p className={ui.fieldError} role="alert">{errors.passengers}</p> : null}
        {errors.legs ? <p className={ui.fieldError} role="alert">{errors.legs}</p> : null}

        <div className={styles.bottom}>
          <span className={ui.hint} aria-live="polite">{total} {total === 1 ? 'pasajero' : 'pasajeros'} · Las fechas son las del aeropuerto de salida.</span>
          <Button type="submit"><Plane size={18} aria-hidden="true" />{submitLabel}</Button>
        </div>
      </form>
    );
  }
);
