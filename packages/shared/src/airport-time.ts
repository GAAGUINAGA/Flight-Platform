import process from 'node:process';

/**
 * Fuente única de zonas horarias de aeropuertos y de la fecha local de vuelo (NFR-TI-01, ADR-F12b1fix-02).
 * `departureDate` es la fecha LOCAL del aeropuerto de origen: su ventana UTC es [00:00 local de D, 00:00 local de D+1).
 */

// La tabla vive en `airport-zones.ts` (sin importaciones, para que el front pueda usar la misma): aquí solo se reexporta.
import { AIRPORT_ZONES, zoneOf } from './airport-zones';
export { AIRPORT_ZONES, zoneOf };

export interface DayWindow {
  /** Si `exclude` es true, la ventana aplica a los aeropuertos que NO están en `iatas`. */
  iatas: string[];
  exclude: boolean;
  from: Date;
  to: Date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, found);
  }
  return found;
}

function parts(ms: number, zone: string): { date: string; time: string; wall: number } {
  const map: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(ms))) map[part.type] = part.value;
  const wall = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, wall };
}

/** Desfase de la zona (ms) en un instante: hora de pared como si fuera UTC menos el instante. */
const offsetAt = (ms: number, zone: string): number => parts(ms, zone).wall - Math.floor(ms / 1000) * 1000;

const nextDate = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** Primer instante del día local `date` (YYYY-MM-DD) en la zona. Si la medianoche no existe (salto de horario) es el primer instante posterior. */
function startOfLocalDay(date: string, zone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const before = offsetAt(wall - 86_400_000, zone);
  const after = offsetAt(wall + 86_400_000, zone);
  const candidates = [wall - before, wall - after];
  const valid = candidates.filter((candidate) => offsetAt(candidate, zone) === wall - candidate);
  return valid.length > 0 ? Math.min(...valid) : Math.max(...candidates);
}

/** Ventana UTC [inicio, fin) del día local `date` en la zona. El día siguiente se calcula por calendario, no sumando 24 h. */
export function localDayRange(date: string, zone: string): [Date, Date] {
  return [new Date(startOfLocalDay(date, zone)), new Date(startOfLocalDay(nextDate(date), zone))];
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona. */
export function localDay(instant: Date | string, zone: string): string {
  return parts(new Date(instant).getTime(), zone).date;
}

/** Hora local (HH:mm) de un instante en la zona. */
export function localTime(instant: Date | string, zone: string): string {
  return parts(new Date(instant).getTime(), zone).time;
}

const warned = new Set<string>();
/** Solo para pruebas. */
export function resetZoneWarnings(): void { warned.clear(); }

export type ZoneWarn = (message: string) => void;
const defaultWarn: ZoneWarn = (message) => { process.stderr.write(`${JSON.stringify({ level: 40, msg: message })}\n`); };

/**
 * Zona del aeropuerto para LEER datos ya guardados: si no se conoce usa UTC y avisa una vez por IATA y proceso.
 * El aviso contiene solo el IATA y la operación (sin datos de pasajeros ni de reservas).
 */
export function resolveZone(iata: string, operation: string, warn: ZoneWarn = defaultWarn): string {
  const zone = zoneOf(iata);
  if (zone) return zone;
  if (!warned.has(iata)) { warned.add(iata); warn(`airport_zone_missing iata=${iata} operation=${operation}`); }
  return 'UTC';
}

/** Fecha local de salida de un vuelo (por IATA de origen). */
export function flightLocalDay(instant: Date | string, iata: string, operation: string, warn?: ZoneWarn): string {
  return localDay(instant, resolveZone(iata, operation, warn));
}

/** Hora local de salida de un vuelo (por IATA de origen). */
export function flightLocalTime(instant: Date | string, iata: string, operation: string, warn?: ZoneWarn): string {
  return localTime(instant, resolveZone(iata, operation, warn));
}

/** Ventana de la fecha local para un aeropuerto de origen conocido. */
export function originDayRange(date: string, iata: string, operation: string, warn?: ZoneWarn): [Date, Date] {
  return localDayRange(date, resolveZone(iata, operation, warn));
}

/**
 * Ventanas de búsqueda por fecha cuando no se conoce el origen: una por zona (con los aeropuertos de esa zona)
 * y una última, en UTC, para los aeropuertos que no están en la tabla.
 */
export function dayWindows(date: string): DayWindow[] {
  const byZone = new Map<string, string[]>();
  for (const [iata, zone] of Object.entries(AIRPORT_ZONES)) byZone.set(zone, [...(byZone.get(zone) ?? []), iata]);
  const windows: DayWindow[] = [...byZone].map(([zone, iatas]) => { const [from, to] = localDayRange(date, zone); return { iatas, exclude: false, from, to }; });
  const [from, to] = localDayRange(date, 'UTC');
  windows.push({ iatas: Object.keys(AIRPORT_ZONES), exclude: true, from, to });
  return windows;
}
