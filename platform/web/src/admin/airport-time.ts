import { zoneOfAirport } from '@flight-platform/format';

/**
 * Horas de vuelo que el administrador captura y ve en la hora LOCAL del aeropuerto (diseño §3.0), nunca en la del navegador.
 * Un valor de `<input type="datetime-local">` (`AAAA-MM-DDTHH:mm`) se convierte a un instante con desplazamiento (`2026-12-10T08:35:00-05:00`)
 * usando la zona IANA del aeropuerto; la conversión inversa deja el valor listo para el campo. Sin React ni DOM: solo `Intl` y `Date`.
 */
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) { found = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); formatters.set(zone, found); }
  return found;
}

/** Milisegundos que la zona se adelanta (o atrasa) respecto de UTC en ese instante. */
function offsetAt(instantMs: number, zone: string): number {
  const map: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(instantMs))) map[part.type] = part.value;
  const wall = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return wall - Math.floor(instantMs / 1000) * 1000;
}

const pad = (value: number): string => String(value).padStart(2, '0');
function offsetText(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+'; const minutes = Math.abs(Math.round(offsetMs / 60_000));
  return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** ¿Es `AAAA-MM-DDTHH:mm` un momento que existe en el calendario? */
export function isLocalDateTime(value: string): boolean {
  const match = LOCAL.exec(value); if (!match) return false;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60;
}

/** `2026-12-10T08:35` en la zona del aeropuerto → `2026-12-10T08:35:00-05:00`. Valor no válido → `null`. */
export function localToIso(value: string, iata: string): string | null {
  if (!isLocalDateTime(value)) return null;
  const match = LOCAL.exec(value)!; const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const zone = zoneOfAirport(iata); const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Dos pasadas: el desplazamiento de la hora local puede diferir del de la estimación inicial (cambios de horario).
  const first = offsetAt(wall, zone); const second = offsetAt(wall - first, zone);
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${offsetText(second)}`;
}

/** Instante (ms) de un valor local en la zona del aeropuerto; `NaN` si no es válido. */
export function localToMs(value: string, iata: string): number {
  const iso = localToIso(value, iata); return iso ? Date.parse(iso) : Number.NaN;
}

/** Un instante → el valor local `AAAA-MM-DDTHH:mm` que muestra el campo, en la zona del aeropuerto. */
export function isoToLocal(instant: string, iata: string): string {
  const time = Date.parse(instant); if (Number.isNaN(time)) return '';
  const map: Record<string, string> = {};
  for (const part of formatter(zoneOfAirport(iata)).formatToParts(new Date(time))) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}
