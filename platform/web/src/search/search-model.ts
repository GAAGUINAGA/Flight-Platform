import { isIsoDate, isKnownAirport, todayAt } from '@flight-platform/format';
import type { CabinClass, SearchInput } from '@flight-platform/graphql-schema/generated/types';

/**
 * Modelo de la búsqueda (diseño F12c-0 §3.1): tipo de viaje, tramos, pasajeros y cabina. Sin React.
 * La búsqueda vive en la URL de Resultados (sin datos personales) para poder recargar, compartir y volver atrás.
 */
export type TripType = 'ida' | 'idavuelta' | 'multi';
export interface Leg { origin: string; destination: string; date: string }
export interface Passengers { adults: number; youths: number; children: number; infants: number }
export interface SearchCriteria { trip: TripType; legs: Leg[]; passengers: Passengers; /** Solo filtra lo que se muestra: el servicio no busca por cabina (H-10). */ cabin: CabinClass | null }

export const MAX_LEGS = 6;
export const MAX_PASSENGERS = 9;
export const CABINS: ReadonlyArray<{ value: CabinClass; label: string }> = [
  { value: 'ECONOMY', label: 'Economy' }, { value: 'PREMIUM_ECONOMY', label: 'Premium Economy' }, { value: 'BUSINESS', label: 'Business' }, { value: 'FIRST', label: 'Primera' }
];
export const cabinLabel = (cabin: CabinClass | string): string => CABINS.find((entry) => entry.value === cabin)?.label ?? cabin;
export const TRIPS: ReadonlyArray<{ value: TripType; label: string }> = [{ value: 'idavuelta', label: 'Ida y vuelta' }, { value: 'ida', label: 'Solo ida' }, { value: 'multi', label: 'Multidestino' }];

export const totalPassengers = (p: Passengers): number => p.adults + p.youths + p.children + p.infants;

/** «2 adultos, 1 niño». */
export function passengersLabel(p: Passengers): string {
  const part = (count: number, one: string, many: string): string | null => (count > 0 ? `${count} ${count === 1 ? one : many}` : null);
  return [part(p.adults, 'adulto', 'adultos'), part(p.youths, 'joven', 'jóvenes'), part(p.children, 'niño', 'niños'), part(p.infants, 'infante', 'infantes')].filter(Boolean).join(', ');
}

export type FieldErrors = Record<string, string>;

/**
 * Valida la búsqueda antes de enviarla. Las claves identifican el campo (`legs.0.origin`, `passengers`…).
 * `now` permite probar la regla «fecha mínima = hoy en la zona del aeropuerto de origen».
 */
export function validateSearch(criteria: SearchCriteria, now: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};
  const { legs, passengers } = criteria;
  if (legs.length < 1 || legs.length > MAX_LEGS) errors.legs = `Elige entre 1 y ${MAX_LEGS} tramos.`;
  legs.forEach((leg, index) => {
    if (!isKnownAirport(leg.origin)) errors[`legs.${index}.origin`] = 'Elige el aeropuerto de origen.';
    if (!isKnownAirport(leg.destination)) errors[`legs.${index}.destination`] = 'Elige el aeropuerto de destino.';
    else if (leg.origin === leg.destination) errors[`legs.${index}.destination`] = 'El destino debe ser distinto del origen.';
    if (!isIsoDate(leg.date)) errors[`legs.${index}.date`] = 'Elige una fecha.';
    else if (isKnownAirport(leg.origin) && leg.date < todayAt(leg.origin, now)) errors[`legs.${index}.date`] = 'La fecha ya pasó en el aeropuerto de origen.';
    else if (index > 0 && isIsoDate(legs[index - 1].date) && leg.date < legs[index - 1].date) errors[`legs.${index}.date`] = criteria.trip === 'idavuelta' ? 'La vuelta no puede ser anterior a la ida.' : 'Este tramo no puede ser anterior al tramo previo.';
  });
  const counts = [passengers.adults, passengers.youths, passengers.children, passengers.infants];
  if (counts.some((count) => !Number.isInteger(count) || count < 0)) errors.passengers = 'Revisa la cantidad de pasajeros.';
  else if (passengers.adults < 1) errors.passengers = 'Debe viajar al menos un adulto.';
  else if (passengers.infants > passengers.adults) errors.passengers = 'Cada infante debe viajar con un adulto.';
  else if (totalPassengers(passengers) > MAX_PASSENGERS) errors.passengers = `Puedes buscar hasta ${MAX_PASSENGERS} pasajeros.`;
  return errors;
}

/** Ajusta los tramos al cambiar el tipo de viaje, conservando lo que el usuario ya eligió. */
export function legsForTrip(trip: TripType, legs: Leg[]): Leg[] {
  const first = legs[0] ?? { origin: '', destination: '', date: '' };
  if (trip === 'ida') return [first];
  if (trip === 'idavuelta') return [first, { origin: first.destination, destination: first.origin, date: legs[1]?.date ?? '' }];
  return legs.length >= 2 ? legs : [first, { origin: first.destination, destination: '', date: '' }];
}

export function toSearchInput(criteria: SearchCriteria): SearchInput {
  return {
    itineraries: criteria.legs.map((leg) => ({ origin: leg.origin, destination: leg.destination, departureDate: leg.date })),
    passengers: { adults: criteria.passengers.adults, youths: criteria.passengers.youths, children: criteria.passengers.children, infants: criteria.passengers.infants }
  };
}

const TRIP_VALUES: TripType[] = ['ida', 'idavuelta', 'multi'];
const LEG = /^([A-Z]{3})-([A-Z]{3})-(\d{4}-\d{2}-\d{2})$/;
const count = (value: string | null, fallback: number): number => { const parsed = Number(value); return value !== null && /^\d{1,2}$/.test(value) && Number.isInteger(parsed) ? parsed : fallback; };

/** Parámetros de `/resultados`. Solo códigos, fechas y cantidades. */
export function toSearchParams(criteria: SearchCriteria): URLSearchParams {
  const params = new URLSearchParams({ tipo: criteria.trip, tramos: criteria.legs.map((leg) => `${leg.origin}-${leg.destination}-${leg.date}`).join(','), adultos: String(criteria.passengers.adults) });
  if (criteria.passengers.youths) params.set('jovenes', String(criteria.passengers.youths));
  if (criteria.passengers.children) params.set('ninos', String(criteria.passengers.children));
  if (criteria.passengers.infants) params.set('infantes', String(criteria.passengers.infants));
  if (criteria.cabin) params.set('cabina', criteria.cabin);
  return params;
}

/** Lee la búsqueda de la URL. Devuelve `null` si la URL no describe una búsqueda bien formada (enlace manipulado o incompleto). */
export function fromSearchParams(params: URLSearchParams): SearchCriteria | null {
  const trip = params.get('tipo') as TripType | null; const raw = params.get('tramos');
  if (!trip || !TRIP_VALUES.includes(trip) || !raw) return null;
  const legs: Leg[] = [];
  for (const part of raw.split(',')) {
    const match = LEG.exec(part);
    if (!match) return null;
    legs.push({ origin: match[1], destination: match[2], date: match[3] });
  }
  if (legs.length > MAX_LEGS || (trip === 'ida' && legs.length !== 1) || (trip === 'idavuelta' && legs.length !== 2)) return null;
  const cabin = params.get('cabina');
  return {
    trip, legs,
    passengers: { adults: count(params.get('adultos'), 1), youths: count(params.get('jovenes'), 0), children: count(params.get('ninos'), 0), infants: count(params.get('infantes'), 0) },
    cabin: CABINS.some((entry) => entry.value === cabin) ? (cabin as CabinClass) : null
  };
}

/** Texto corto de la ruta: «UIO → GPS» o, con varios tramos, «UIO → GPS · GPS → UIO». */
export const routeLabel = (legs: Leg[]): string => legs.map((leg) => `${leg.origin} – ${leg.destination}`).join(' · ');
