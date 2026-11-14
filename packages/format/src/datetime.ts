import { cityOf, isKnownAirport, zoneOfAirport } from './airports';

/**
 * Fechas y horas de vuelo SIEMPRE en la hora local del aeropuerto (ADR-F12b1fix-02, diseño §3.0), nunca en la del dispositivo.
 * Solo `Intl` y `Date`: sirve igual en el navegador y en React Native.
 */
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, found);
  }
  return found;
}

function parts(instant: string | Date, zone: string): { date: string; time: string } | undefined {
  const value = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(value.getTime())) return undefined;
  const map: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(value)) map[part.type] = part.value;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}

/** `AAAA-MM-DD` válida (existe en el calendario). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** Fecha local (`AAAA-MM-DD`) de un instante en la zona del aeropuerto. */
export function localDate(instant: string | Date, iata: string): string {
  return parts(instant, zoneOfAirport(iata))?.date ?? '';
}

/** Hora local (`HH:mm`, 24 h) de un instante en la zona del aeropuerto. Instante no válido → `--:--`. */
export function formatLocalTime(instant: string | Date, iata: string): string {
  return parts(instant, zoneOfAirport(iata))?.time ?? '--:--';
}

/** «hora de Quito»; aeropuerto sin zona conocida → «UTC» (se muestra en UTC, sin fallar). */
export function zoneLabel(iata: string): string {
  return isKnownAirport(iata) ? `hora de ${cityOf(iata)}` : 'UTC';
}

/** «08:35 · hora de Quito». */
export function formatLocalTimeWithZone(instant: string | Date, iata: string): string {
  return `${formatLocalTime(instant, iata)} · ${zoneLabel(iata)}`;
}

/** Fecha de calendario `AAAA-MM-DD` → «10 dic 2026» (con `weekday`: «jue 10 dic 2026»). No depende de la zona del dispositivo. */
export function formatDate(isoDate: string, options: { weekday?: boolean } = {}): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match || !isIsoDate(isoDate)) return isoDate;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const text = `${day} ${MONTHS[month - 1]} ${year}`;
  return options.weekday ? `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${text}` : text;
}

/** Fecha local de un instante en la zona del aeropuerto, lista para mostrar. */
export function formatLocalDate(instant: string | Date, iata: string, options: { weekday?: boolean } = {}): string {
  const date = localDate(instant, iata);
  return date ? formatDate(date, options) : '';
}

/** Días de calendario entre la salida (hora local del origen) y la llegada (hora local del destino): 1 ⇒ «+1». */
export function dayOffset(departureAt: string | Date, originIata: string, arrivalAt: string | Date, destinationIata: string): number {
  const from = localDate(departureAt, originIata); const to = localDate(arrivalAt, destinationIata);
  if (!from || !to) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** «+1» / «−1» o cadena vacía si llega el mismo día local. */
export function dayOffsetLabel(departureAt: string | Date, originIata: string, arrivalAt: string | Date, destinationIata: string): string {
  const days = dayOffset(departureAt, originIata, arrivalAt, destinationIata);
  return days === 0 ? '' : days > 0 ? `+${days}` : `−${Math.abs(days)}`;
}

/** Hoy (`AAAA-MM-DD`) en la zona del aeropuerto: fecha mínima del buscador. */
export function todayAt(iata: string, now: Date = new Date()): string {
  return localDate(now, iata);
}

/** Suma días de calendario a una fecha `AAAA-MM-DD`. */
export function addDays(isoDate: string, days: number): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return isoDate;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days)).toISOString().slice(0, 10);
}

/** Minutos → «1 h 55 min», «2 h», «45 min». */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return '';
  const whole = Math.round(minutes); const hours = Math.floor(whole / 60); const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
