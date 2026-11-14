import { formatLocalDate, formatLocalTime, zoneLabel } from '@flight-platform/format';

/**
 * Ayuda de la ventana de check-in (diseño F12c-0 §3.12). La AUTORIDAD es el servidor (Operations): esto solo calcula
 * cuándo abre y cierra con la salida del primer tramo pendiente, EN LA HORA LOCAL DEL AEROPUERTO. Sin React ni DOM.
 */
export interface CheckInWindowInput { departureAt: string; origin: string; now?: Date; openHours: number; closeMinutes: number }
export type CheckInState = 'before' | 'open' | 'closed';
export interface CheckInWindow { state: CheckInState; opensAt: Date; closesAt: Date; opensLabel: string; closesLabel: string }

const HOUR = 3_600_000; const MINUTE = 60_000;

/** «8 dic 2026 a las 08:35, hora de Quito» */
export function instantLabel(instant: Date, iata: string): string {
  return `${formatLocalDate(instant, iata)} a las ${formatLocalTime(instant, iata)}, ${zoneLabel(iata)}`;
}

/** Abre `openHours` antes de la salida y cierra `closeMinutes` antes. El instante exacto de apertura ya está abierto; el de cierre ya está cerrado. */
export function checkInWindow(input: CheckInWindowInput): CheckInWindow | null {
  const departure = Date.parse(input.departureAt);
  if (!Number.isFinite(departure) || !(input.openHours > 0) || !(input.closeMinutes >= 0)) return null;
  const now = (input.now ?? new Date()).getTime();
  const opensAt = new Date(departure - input.openHours * HOUR); const closesAt = new Date(departure - input.closeMinutes * MINUTE);
  const state: CheckInState = now < opensAt.getTime() ? 'before' : now < closesAt.getTime() ? 'open' : 'closed';
  return { state, opensAt, closesAt, opensLabel: instantLabel(opensAt, input.origin), closesLabel: instantLabel(closesAt, input.origin) };
}

export interface SegmentRef { segmentId: string; departureAt: string; origin: string }

/** Primer tramo pendiente: el de salida más próxima que aún no salió y que no tiene pase de abordar (el estado de check-in se deduce de los pases, H-7). */
export function nextPendingSegment(segments: readonly SegmentRef[], withPass: ReadonlySet<string>, now: Date = new Date()): SegmentRef | null {
  const pending = segments.filter((segment) => !withPass.has(segment.segmentId) && Date.parse(segment.departureAt) > now.getTime());
  pending.sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt));
  return pending[0] ?? null;
}

/** Texto para el cliente según la ventana calculada (la decisión final es del servidor). */
export function checkInMessage(window: CheckInWindow | null): string {
  if (!window) return 'No pudimos calcular cuándo abre el check-in. Puedes intentarlo y te indicaremos si está disponible.';
  if (window.state === 'before') return `El check-in abre el ${window.opensLabel}.`;
  if (window.state === 'open') return `El check-in está abierto y cierra el ${window.closesLabel}.`;
  return `El check-in cerró el ${window.closesLabel}.`;
}
