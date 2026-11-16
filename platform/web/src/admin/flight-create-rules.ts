import type { CreateFlightInput } from '@flight-platform/graphql-schema/generated/types';
import { isoToLocal, localToIso } from './airport-time';

/**
 * Reglas del formulario «Crear vuelo» (F12c-4c, ADR-F12c4-01 P6). Sin React ni DOM. La AUTORIDAD es el Gateway: aquí se avisa antes de enviar y se calcula
 * lo que el administrador ve (la llegada en la hora local del destino). Las horas locales ambiguas o inexistentes las rechaza el servidor (se muestran con su motivo).
 */
export const FLIGHT_PREFIX = 'FP';
export const CABIN_ORDER = ['FIRST', 'BUSINESS', 'PREMIUM_ECONOMY', 'ECONOMY'] as const;
export type Cabin = (typeof CABIN_ORDER)[number];
export const CABIN_LABEL: Readonly<Record<string, string>> = { ECONOMY: 'Económica', PREMIUM_ECONOMY: 'Premium', BUSINESS: 'Ejecutiva', FIRST: 'Primera' };
export const MAX_FARES_PER_CABIN = 4;

export interface FareDraft { cabinClass: Cabin; fareBrand: string; baseFare: string; taxes: string; isRefundable: boolean; isChangeable: boolean; carryOnIncluded: string; checkedBaggageIncluded: string; extraBaggagePrice: string }
export interface FlightDraft { digits: string; origin: string; destination: string; departureLocal: string; durationMinutes: string; aircraft: string; fares: FareDraft[]; leaveClosed: boolean }
export interface Aircraft { code: string; cabins: Array<{ cabinClass: string; seats: number }> }
export interface RuleLimits { minLeadMinutes: number; maxDaysAhead: number; minDurationMinutes: number; maxDurationMinutes: number }
/** Los mismos valores por omisión que el Gateway (`ADMIN_FLIGHT_*`); solo orientan: el Gateway decide. */
export const DEFAULT_LIMITS: RuleLimits = { minLeadMinutes: 60, maxDaysAhead: 400, minDurationMinutes: 20, maxDurationMinutes: 1200 };

export const emptyFare = (cabinClass: Cabin, brand = 'Basic'): FareDraft => ({ cabinClass, fareBrand: brand, baseFare: '', taxes: '', isRefundable: false, isChangeable: false, carryOnIncluded: '1', checkedBaggageIncluded: '0', extraBaggagePrice: '' });
export const emptyDraft = (): FlightDraft => ({ digits: '', origin: '', destination: '', departureLocal: '', durationMinutes: '', aircraft: '', fares: [], leaveClosed: false });
export const flightNumberOf = (digits: string): string => `${FLIGHT_PREFIX}${digits}`;
/** Una fila de tarifa por cada cabina del avión (hasta que el administrador agregue más marcas). */
export const faresFor = (aircraft: Aircraft | undefined): FareDraft[] => (aircraft ? [...aircraft.cabins].sort((a, b) => CABIN_ORDER.indexOf(a.cabinClass as Cabin) - CABIN_ORDER.indexOf(b.cabinClass as Cabin)).map((cabin) => emptyFare(cabin.cabinClass as Cabin)) : []);

const cents = (value: string): number => Number(value.replace('.', ''));
/** `12`, `12.5` o `12,50` → `12.50`; texto no numérico → `null`. */
export function normalizeAmount(value: string): string | null {
  const text = value.trim().replace(',', '.'); if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.'); return `${whole}.${fraction.padEnd(2, '0')}`;
}
export const totalOf = (fare: Pick<FareDraft, 'baseFare' | 'taxes'>): string | null => {
  const base = normalizeAmount(fare.baseFare); const taxes = normalizeAmount(fare.taxes || '0'); if (!base || !taxes) return null;
  return ((cents(base) + cents(taxes)) / 100).toFixed(2);
};

/** Llegada en la hora local del DESTINO (`AAAA-MM-DDTHH:mm`) a partir de la salida local del origen y la duración; `null` si falta algo. */
export function arrivalLocalOf(draft: Pick<FlightDraft, 'origin' | 'destination' | 'departureLocal' | 'durationMinutes'>): string | null {
  const minutes = Number(draft.durationMinutes); if (!draft.origin || !draft.destination || !Number.isInteger(minutes) || minutes <= 0) return null;
  const iso = localToIso(draft.departureLocal, draft.origin); if (!iso) return null;
  return isoToLocal(new Date(Date.parse(iso) + minutes * 60_000).toISOString(), draft.destination) || null;
}

export type DraftErrors = Record<string, string>;
export function validateDraft(draft: FlightDraft, aircraft: Aircraft | undefined, now: Date, limits: RuleLimits = DEFAULT_LIMITS): DraftErrors {
  const errors: DraftErrors = {};
  if (!/^\d{1,4}$/.test(draft.digits)) errors.digits = 'Escribe de 1 a 4 dígitos (por ejemplo, 210).';
  if (!draft.origin) errors.origin = 'Elige el origen.';
  if (!draft.destination) errors.destination = 'Elige el destino.'; else if (draft.destination === draft.origin) errors.destination = 'El destino debe ser distinto del origen.';
  const minutes = Number(draft.durationMinutes);
  if (!Number.isInteger(minutes) || draft.durationMinutes.trim() === '') errors.durationMinutes = 'Escribe la duración en minutos.';
  else if (minutes < limits.minDurationMinutes || minutes > limits.maxDurationMinutes) errors.durationMinutes = `La duración debe estar entre ${limits.minDurationMinutes} minutos y ${limits.maxDurationMinutes / 60} horas.`;
  const departure = draft.origin ? localToIso(draft.departureLocal, draft.origin) : null;
  if (!draft.departureLocal) errors.departureLocal = 'Elige la fecha y la hora de salida (hora local del origen).';
  else if (draft.origin && !departure) errors.departureLocal = 'La fecha u hora no es válida.';
  else if (departure) {
    const ahead = (Date.parse(departure) - now.getTime()) / 60_000;
    if (ahead < limits.minLeadMinutes) errors.departureLocal = `La salida debe ser al menos ${limits.minLeadMinutes} minutos después de ahora.`;
    else if (ahead > limits.maxDaysAhead * 1440) errors.departureLocal = `La salida no puede ser a más de ${limits.maxDaysAhead} días.`;
  }
  if (!draft.aircraft || !aircraft) errors.aircraft = 'Elige el avión.';
  else {
    for (const cabin of aircraft.cabins) {
      const rows = draft.fares.filter((fare) => fare.cabinClass === cabin.cabinClass);
      if (rows.length === 0) errors[`cabin.${cabin.cabinClass}`] = `Falta al menos una tarifa en ${CABIN_LABEL[cabin.cabinClass] ?? cabin.cabinClass}.`;
      if (rows.length > MAX_FARES_PER_CABIN) errors[`cabin.${cabin.cabinClass}`] = `Máximo ${MAX_FARES_PER_CABIN} tarifas por cabina.`;
    }
  }
  const seen = new Set<string>();
  draft.fares.forEach((fare, index) => {
    const base = normalizeAmount(fare.baseFare); const taxes = normalizeAmount(fare.taxes || '0'); const bag = normalizeAmount(fare.extraBaggagePrice);
    if (!fare.fareBrand.trim() || fare.fareBrand.trim().length > 32) errors[`fares.${index}.fareBrand`] = 'Escribe la marca (hasta 32 caracteres).';
    const identity = `${fare.cabinClass}|${fare.fareBrand.trim().toLowerCase()}`; if (seen.has(identity)) errors[`fares.${index}.fareBrand`] = 'Esa marca ya existe en la cabina.'; seen.add(identity);
    if (!base) errors[`fares.${index}.baseFare`] = 'Importe en USD (por ejemplo, 80.00).';
    if (!taxes) errors[`fares.${index}.taxes`] = 'Importe en USD (puede ser 0.00).';
    else if (base && cents(base) + cents(taxes) <= 0) errors[`fares.${index}.baseFare`] = 'El total debe ser mayor que cero.';
    if (!bag) errors[`fares.${index}.extraBaggagePrice`] = 'Importe en USD.';
    for (const field of ['carryOnIncluded', 'checkedBaggageIncluded'] as const) { const value = Number(fare[field]); if (!Number.isInteger(value) || value < 0 || value > 9) errors[`fares.${index}.${field}`] = 'De 0 a 9.'; }
  });
  return errors;
}

export function toCreateInput(draft: FlightDraft): CreateFlightInput {
  return {
    flightNumber: flightNumberOf(draft.digits), origin: draft.origin, destination: draft.destination, departureLocal: draft.departureLocal, durationMinutes: Number(draft.durationMinutes), aircraft: draft.aircraft,
    openForSale: !draft.leaveClosed,
    fares: draft.fares.map((fare) => ({
      cabinClass: fare.cabinClass, fareBrand: fare.fareBrand.trim(), baseFare: normalizeAmount(fare.baseFare) ?? fare.baseFare, taxes: normalizeAmount(fare.taxes || '0') ?? fare.taxes, isRefundable: fare.isRefundable, isChangeable: fare.isChangeable,
      carryOnIncluded: Number(fare.carryOnIncluded), checkedBaggageIncluded: Number(fare.checkedBaggageIncluded), extraBaggagePrice: normalizeAmount(fare.extraBaggagePrice) ?? fare.extraBaggagePrice
    }))
  };
}

/** Firma de la intención: si cambia cualquier dato, es otra intención (otra Idempotency-Key). */
export const draftSignature = (draft: FlightDraft): string => JSON.stringify(toCreateInput(draft));

/** Una tarifa guardada de otro vuelo → fila del formulario con un FACTOR aplicado (redondeo al centavo). Solo cabinas del avión elegido. */
export interface StoredFare { cabinClass: string; fareBrand: string; price: { baseFare?: string | null; taxes?: string | null; total: string }; fareRules: { isRefundable: boolean; isChangeable: boolean }; baggageAllowance: { carryOnIncluded?: number | null; checkedBaggageIncluded?: number | null }; extraCheckedBaggagePrice: { total: string } }
export const parseFactor = (value: string): number | null => { const n = Number(value.trim().replace(',', '.')); return Number.isFinite(n) && n > 0 && n <= 10 ? n : null; };
const scale = (amount: string | null | undefined, factor: number): string => (Math.round(Number(amount ?? '0') * 100 * factor) / 100).toFixed(2);
export function copyFares(stored: StoredFare[], aircraft: Aircraft, factor: number): FareDraft[] {
  const cabins = new Set(aircraft.cabins.map((cabin) => cabin.cabinClass));
  return stored.filter((fare) => cabins.has(fare.cabinClass) && (CABIN_ORDER as readonly string[]).includes(fare.cabinClass)).slice(0, 16).map((fare) => ({
    cabinClass: fare.cabinClass as Cabin, fareBrand: fare.fareBrand.slice(0, 32),
    baseFare: scale(fare.price.baseFare ?? fare.price.total, factor), taxes: scale(fare.price.taxes ?? '0.00', factor),
    isRefundable: fare.fareRules.isRefundable, isChangeable: fare.fareRules.isChangeable,
    carryOnIncluded: String(fare.baggageAllowance.carryOnIncluded ?? 0), checkedBaggageIncluded: String(fare.baggageAllowance.checkedBaggageIncluded ?? 0), extraBaggagePrice: scale(fare.extraCheckedBaggagePrice.total, factor)
  }));
}

/** Motivos del Gateway (`invalidParams[].reason`) → texto para el administrador. */
const REASONS: Readonly<Record<string, string>> = {
  'airline-prefix': 'El número debe empezar con el prefijo de la aerolínea.', 'airport-unknown': 'Ese aeropuerto no está en la tabla de zonas.', 'same-as-origin': 'El destino debe ser distinto del origen.',
  'duration-out-of-range': 'La duración está fuera del rango permitido.', 'local-time-nonexistent': 'Esa hora local no existe en el aeropuerto (salto de horario de verano): elige otra.',
  'local-time-ambiguous': 'Esa hora local se repite en el aeropuerto (cambio de horario): elige otra.', 'too-soon': 'La salida es demasiado pronto.', 'too-far': 'La salida es demasiado lejana.',
  'aircraft-not-supported': 'Ese avión no está en el catálogo.', 'currency-not-allowed': 'Solo se admite USD.', 'cabin-not-in-aircraft': 'Esa cabina no existe en el avión elegido.',
  'duplicate-brand': 'Esa marca ya existe en la cabina.', 'total-not-positive': 'El total debe ser mayor que cero.', invalid: 'El valor no es válido.'
};
export const reasonText = (reason: string | undefined): string => (reason ? (REASONS[reason] ?? (reason.startsWith('missing-fare-') ? `Falta al menos una tarifa en la cabina ${reason.slice('missing-fare-'.length)}.` : reason.startsWith('too-many-fares-') ? `Demasiadas tarifas en la cabina ${reason.slice('too-many-fares-'.length)}.` : 'Revisa este campo.')) : 'Revisa este campo.');
