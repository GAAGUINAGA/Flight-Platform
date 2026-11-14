// La tabla de zonas es la ÚNICA del proyecto (`packages/shared/src/airport-zones.ts`, sin importaciones). Aquí solo se le suman los nombres para mostrar.
import { AIRPORT_ZONES } from '@flight-platform/shared/dist/src/airport-zones';

export interface Airport { iata: string; city: string; name: string; country: string; zone: string }

/** Nombres para mostrar (diseño §5.3, hueco H-1: no hay catálogo en el backend). Las claves deben existir en `AIRPORT_ZONES` (lo comprueba una prueba). */
export const AIRPORT_NAMES: Readonly<Record<string, { city: string; name: string; country: string }>> = {
  UIO: { city: 'Quito', name: 'Mariscal Sucre', country: 'Ecuador' },
  GYE: { city: 'Guayaquil', name: 'José Joaquín de Olmedo', country: 'Ecuador' },
  CUE: { city: 'Cuenca', name: 'Mariscal La Mar', country: 'Ecuador' },
  LTX: { city: 'Latacunga', name: 'Cotopaxi', country: 'Ecuador' },
  MEC: { city: 'Manta', name: 'Eloy Alfaro', country: 'Ecuador' },
  ESM: { city: 'Esmeraldas', name: 'Carlos Concha Torres', country: 'Ecuador' },
  TUA: { city: 'Tulcán', name: 'Luis A. Mantilla', country: 'Ecuador' },
  LOH: { city: 'Loja', name: 'Ciudad de Catamayo', country: 'Ecuador' },
  PVO: { city: 'Portoviejo', name: 'Reales Tamarindos', country: 'Ecuador' },
  OCC: { city: 'Coca', name: 'Francisco de Orellana', country: 'Ecuador' },
  TPC: { city: 'Tarapoa', name: 'Tarapoa', country: 'Ecuador' },
  XMS: { city: 'Macas', name: 'Edmundo Carvajal', country: 'Ecuador' },
  GPS: { city: 'Baltra (Galápagos)', name: 'Seymour', country: 'Ecuador' },
  SCY: { city: 'San Cristóbal (Galápagos)', name: 'San Cristóbal', country: 'Ecuador' },
  BOG: { city: 'Bogotá', name: 'El Dorado', country: 'Colombia' },
  MDE: { city: 'Medellín', name: 'José María Córdova', country: 'Colombia' },
  LIM: { city: 'Lima', name: 'Jorge Chávez', country: 'Perú' },
  MAD: { city: 'Madrid', name: 'Adolfo Suárez Madrid-Barajas', country: 'España' },
  MIA: { city: 'Miami', name: 'Internacional de Miami', country: 'Estados Unidos' }
};

/** Aeropuertos que ofrece el buscador: todos los de la tabla única, ordenados por ciudad. Un IATA sin nombre se muestra con su código. */
export const AIRPORTS: readonly Airport[] = Object.keys(AIRPORT_ZONES)
  .map((iata) => ({ iata, zone: AIRPORT_ZONES[iata], ...(AIRPORT_NAMES[iata] ?? { city: iata, name: iata, country: '' }) }))
  .sort((a, b) => a.city.localeCompare(b.city, 'es'));

const BY_IATA = new Map(AIRPORTS.map((airport) => [airport.iata, airport]));

export const airportOf = (iata: string): Airport | undefined => BY_IATA.get(iata);
/** Ciudad para mostrar; si el aeropuerto no está en la tabla, su código IATA. */
export const cityOf = (iata: string): string => BY_IATA.get(iata)?.city ?? iata;
/** Zona IANA del aeropuerto; `UTC` si no está en la tabla (igual que la lectura del backend). */
export const zoneOfAirport = (iata: string): string => BY_IATA.get(iata)?.zone ?? 'UTC';
export const isKnownAirport = (iata: string): boolean => BY_IATA.has(iata);
/** «Quito (UIO)». */
export const airportLabel = (iata: string): string => (BY_IATA.has(iata) ? `${cityOf(iata)} (${iata})` : iata);
