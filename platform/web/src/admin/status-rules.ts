import type { FlightStatusCode, FlightStatusUpdateInput } from '@flight-platform/graphql-schema/generated/types';
import { isLocalDateTime, localToIso, localToMs } from './airport-time';

/**
 * Reglas del cambio de estado de un vuelo (diseño §3.13). Sin React ni DOM. La autoridad es el Gateway (`409 INVALID_STATUS_TRANSITION`);
 * esta tabla es una COPIA de `flight-transitions.ts` del Gateway para ofrecer solo lo válido y avisar antes de enviar.
 */
export const FLIGHT_STATUSES: readonly FlightStatusCode[] = ['SCHEDULED', 'BOARDING', 'DELAYED', 'DEPARTED', 'ARRIVED', 'CANCELLED', 'DIVERTED'];

export const STATUS_LABEL: Readonly<Record<FlightStatusCode, string>> = {
  SCHEDULED: 'Programado', BOARDING: 'Embarcando', DEPARTED: 'En vuelo', DELAYED: 'Retrasado', ARRIVED: 'Aterrizó', CANCELLED: 'Cancelado', DIVERTED: 'Desviado'
};

const ALLOWED: Readonly<Record<FlightStatusCode, readonly FlightStatusCode[]>> = {
  SCHEDULED: ['BOARDING', 'DELAYED', 'CANCELLED'], BOARDING: ['DELAYED', 'DEPARTED'], DELAYED: ['BOARDING', 'CANCELLED'],
  DEPARTED: ['ARRIVED', 'DIVERTED'], ARRIVED: [], CANCELLED: [], DIVERTED: []
};

/** Repetir el estado actual es válido (solo cambian estimaciones, puerta o motivo). */
export const canTransition = (from: FlightStatusCode, to: FlightStatusCode): boolean => from === to || ALLOWED[from].includes(to);

/** Estados que ofrece el formulario: el actual y sus destinos válidos. Sin estado conocido se ofrecen todos y decide el Gateway. */
export const targetsFrom = (from: FlightStatusCode | null): readonly FlightStatusCode[] => (from ? [from, ...ALLOWED[from]] : FLIGHT_STATUSES);

/** Pasar a DELAYED o a CANCELLED no se deshace desde el panel: exige escribir el número del vuelo. */
export const isIrreversible = (target: FlightStatusCode): boolean => target === 'DELAYED' || target === 'CANCELLED';

/** El número de vuelo escrito coincide (sin espacios ni mayúsculas). */
export const confirmationMatches = (typed: string, flightNumber: string): boolean => typed.replace(/\s+/g, '').toUpperCase() === flightNumber.toUpperCase();

export interface StatusDraft { status: FlightStatusCode | ''; estimatedDeparture: string; estimatedArrival: string; gate: string; reason: string }
export interface StatusContext { flightNumber: string; date: string; current: FlightStatusCode | null; origin: string; destination: string; departureAt: string }
export type StatusErrors = Partial<Record<keyof StatusDraft, string>>;

export const GATE = /^[A-Za-z0-9-]{1,8}$/;
export const REASON_MAX = 200;

export function emptyDraft(current: FlightStatusCode | null): StatusDraft {
  return { status: current ?? '', estimatedDeparture: '', estimatedArrival: '', gate: '', reason: '' };
}

/** Errores por campo, en español; vacío = se puede enviar. */
export function validateStatus(draft: StatusDraft, context: StatusContext): StatusErrors {
  const errors: StatusErrors = {};
  if (!draft.status) { errors.status = 'Elige el estado al que pasa el vuelo.'; return errors; }
  if (context.current && !canTransition(context.current, draft.status)) errors.status = `Un vuelo ${STATUS_LABEL[context.current].toLowerCase()} no puede pasar a «${STATUS_LABEL[draft.status].toLowerCase()}».`;
  const cancelled = draft.status === 'CANCELLED';
  if (!cancelled) {
    if (draft.estimatedDeparture && !isLocalDateTime(draft.estimatedDeparture)) errors.estimatedDeparture = 'Escribe una fecha y hora válidas.';
    if (draft.estimatedArrival && !isLocalDateTime(draft.estimatedArrival)) errors.estimatedArrival = 'Escribe una fecha y hora válidas.';
    if (draft.status === 'DELAYED' && !draft.estimatedDeparture) errors.estimatedDeparture = 'Un retraso necesita la nueva hora estimada de salida.';
    const departure = errors.estimatedDeparture || !draft.estimatedDeparture ? Number.NaN : localToMs(draft.estimatedDeparture, context.origin);
    if (draft.status === 'DELAYED' && !Number.isNaN(departure) && departure <= Date.parse(context.departureAt)) errors.estimatedDeparture = 'La hora estimada de un retraso debe ser posterior a la hora programada.';
    if (!errors.estimatedArrival && draft.estimatedArrival && !Number.isNaN(departure) && localToMs(draft.estimatedArrival, context.destination) <= departure) errors.estimatedArrival = 'La llegada estimada debe ser posterior a la salida estimada.';
  }
  if (draft.gate && !GATE.test(draft.gate.trim())) errors.gate = 'La puerta tiene hasta 8 letras, números o guiones.';
  if (draft.reason.trim().length > REASON_MAX) errors.reason = `El motivo admite hasta ${REASON_MAX} caracteres.`;
  return errors;
}

/** Entrada de `updateFlightStatus` (las horas con su desplazamiento). Se asume el borrador ya validado. */
export function toStatusInput(draft: StatusDraft, context: StatusContext): FlightStatusUpdateInput {
  const cancelled = draft.status === 'CANCELLED';
  const departure = !cancelled && draft.estimatedDeparture ? localToIso(draft.estimatedDeparture, context.origin) : null;
  const arrival = !cancelled && draft.estimatedArrival ? localToIso(draft.estimatedArrival, context.destination) : null;
  return {
    date: context.date, status: draft.status as FlightStatusCode,
    ...(departure ? { estimatedDepartureAt: departure } : {}), ...(arrival ? { estimatedArrivalAt: arrival } : {}),
    ...(draft.gate.trim() ? { departureGate: draft.gate.trim().toUpperCase() } : {}), ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {})
  };
}

/** Lo que la confirmación debe decir antes de ejecutar (texto, para que se pueda probar sin pantalla). */
export function confirmationNotes(to: FlightStatusCode): { notifies: string; irreversible: string | null } {
  const notifies = 'Este cambio se avisa a los socios (Booking) y a los clientes mediante los webhooks.';
  if (to === 'CANCELLED') return { notifies, irreversible: 'Cancelar el vuelo cierra su venta y notifica a las reservas afectadas. No se puede deshacer.' };
  if (to === 'DELAYED') return { notifies, irreversible: 'Pasar el vuelo a «retrasado» notifica el nuevo horario y no se puede deshacer desde este panel.' };
  return { notifies, irreversible: null };
}

/** Clave de la intención: los mismos datos del mismo vuelo reutilizan la Idempotency-Key (doble clic, reintento). */
export const statusSignature = (input: FlightStatusUpdateInput, flightNumber: string): string =>
  [flightNumber, input.date, input.status, input.estimatedDepartureAt ?? '', input.estimatedArrivalAt ?? '', input.departureGate ?? '', input.reason ?? ''].join('|');
