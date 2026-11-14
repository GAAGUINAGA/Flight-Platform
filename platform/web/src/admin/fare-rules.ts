import { formatMoney } from '@flight-platform/format';
import type { AdminFareFieldsFragment, CabinClass, UpsertFareInput } from '@flight-platform/graphql-schema/generated/types';

/**
 * Reglas de la pantalla de tarifas (diseño §3.13). Sin React ni DOM. Los importes son CADENAS decimales con dos decimales (`"127.39"`):
 * nunca se usa aritmética de coma flotante; las comparaciones se hacen en centavos enteros.
 */
export const CABINS: readonly CabinClass[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
export const CABIN_LABEL: Readonly<Record<CabinClass, string>> = { ECONOMY: 'Económica', PREMIUM_ECONOMY: 'Premium económica', BUSINESS: 'Business', FIRST: 'Primera' };

/** «12,5» / «12.50» / « 12 » → «12.50». Cualquier otra cosa (negativos, letras, tres decimales, vacío) → `null`. */
export function normalizeAmount(text: string): string | null {
  const value = text.trim().replace(',', '.');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value);
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}` : null;
}
export const cents = (amount: string): number => { const [whole, fraction = '0'] = amount.split('.'); return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2)); };

/**
 * El importe de una tarifa. Pricing guarda la tarifa BASE y las TASAS y el total es siempre su suma (`fare-admin.ts`): un `total` que no
 * coincida con base + tasas se ignoraría en silencio. Por eso el formulario edita el importe TOTAL y las tasas (incluidas en él) y la
 * tarifa base se DERIVA (total − tasas); lo que se envía es siempre coherente.
 */
export interface FareDraft {
  total: string; taxes: string; isRefundable: boolean; isChangeable: boolean;
  personalItemIncluded: boolean; carryOnIncluded: string; checkedBaggageIncluded: string; extraBaggage: string;
}
export type FareErrors = Partial<Record<keyof FareDraft, string>>;

export const MAX_BAGS = 9;
export const FARE_BRAND = /^[A-Za-z0-9 _-]{1,32}$/;

const fromCents = (value: number): string => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
/** Tarifa base = total − tasas (sin tasas, el total entero). `null` si el total o las tasas no son válidos o las tasas superan al total. */
export function derivedBase(draft: Pick<FareDraft, 'total' | 'taxes'>): string | null {
  const total = normalizeAmount(draft.total); const taxes = draft.taxes.trim() ? normalizeAmount(draft.taxes) : '0.00';
  if (total === null || taxes === null || cents(taxes) > cents(total)) return null;
  return fromCents(cents(total) - cents(taxes));
}

const optionalAmount = (value: unknown): string => (typeof value === 'string' ? value : '');
export function draftFromFare(fare: AdminFareFieldsFragment | null): FareDraft {
  return {
    total: fare?.price.total ?? '', taxes: optionalAmount(fare?.price.taxes),
    isRefundable: fare?.fareRules.isRefundable ?? false, isChangeable: fare?.fareRules.isChangeable ?? false,
    personalItemIncluded: fare?.baggageAllowance.personalItemIncluded ?? true,
    carryOnIncluded: String(fare?.baggageAllowance.carryOnIncluded ?? 1), checkedBaggageIncluded: String(fare?.baggageAllowance.checkedBaggageIncluded ?? 0),
    extraBaggage: fare?.extraCheckedBaggagePrice.total ?? ''
  };
}

const bag = (text: string): number | null => (/^\d{1,2}$/.test(text.trim()) && Number(text) <= MAX_BAGS ? Number(text) : null);

/** Errores por campo, en español; vacío = se puede enviar. */
export function validateFare(draft: FareDraft, identity: { cabinClass: CabinClass | ''; fareBrand: string } | null = null): FareErrors & { cabinClass?: string; fareBrand?: string } {
  const errors: FareErrors & { cabinClass?: string; fareBrand?: string } = {};
  if (identity) {
    if (!identity.cabinClass) errors.cabinClass = 'Elige la cabina.';
    if (!FARE_BRAND.test(identity.fareBrand.trim())) errors.fareBrand = 'La marca tarifaria tiene entre 1 y 32 letras, números, espacios o guiones.';
  }
  const total = normalizeAmount(draft.total);
  if (total === null) errors.total = 'Escribe el importe con hasta dos decimales, por ejemplo 127.39.';
  else if (cents(total) === 0) errors.total = 'El importe total debe ser mayor que cero.';
  if (draft.taxes.trim()) {
    const taxes = normalizeAmount(draft.taxes);
    if (taxes === null) errors.taxes = 'Escribe unas tasas válidas, por ejemplo 12.50, o déjalas vacías.';
    else if (total !== null && cents(taxes) > cents(total)) errors.taxes = 'Las tasas están incluidas en el total: no pueden superarlo.';
  }
  const extra = normalizeAmount(draft.extraBaggage);
  if (extra === null) errors.extraBaggage = 'Escribe el precio de la maleta extra con hasta dos decimales (puede ser 0.00).';
  if (bag(draft.carryOnIncluded) === null) errors.carryOnIncluded = `Un número entero de 0 a ${MAX_BAGS}.`;
  if (bag(draft.checkedBaggageIncluded) === null) errors.checkedBaggageIncluded = `Un número entero de 0 a ${MAX_BAGS}.`;
  return errors;
}

/** Entrada de `upsertFare`. Se asume el borrador ya validado. La clave natural (vuelo, cabina, marca) la actualiza y conserva `fareId`. */
export function toFareInput(draft: FareDraft, target: { flightInstanceId: string; cabinClass: CabinClass; fareBrand: string; fareId?: string; currency: string }): UpsertFareInput {
  const taxes = draft.taxes.trim() ? normalizeAmount(draft.taxes) ?? undefined : undefined; const baseFare = taxes ? derivedBase(draft) ?? undefined : undefined;
  return {
    ...(target.fareId ? { fareId: target.fareId } : {}), flightInstanceId: target.flightInstanceId, cabinClass: target.cabinClass, fareBrand: target.fareBrand.trim(),
    price: { currency: target.currency, total: normalizeAmount(draft.total) ?? '0.00', ...(baseFare && taxes ? { baseFare, taxes } : {}) },
    isRefundable: draft.isRefundable, isChangeable: draft.isChangeable, personalItemIncluded: draft.personalItemIncluded,
    carryOnIncluded: bag(draft.carryOnIncluded) ?? 0, checkedBaggageIncluded: bag(draft.checkedBaggageIncluded) ?? 0,
    extraCheckedBaggagePrice: { currency: target.currency, total: normalizeAmount(draft.extraBaggage) ?? '0.00' }
  };
}

export interface Change { label: string; before: string; after: string }
const yesNo = (value: boolean): string => (value ? 'Sí' : 'No');
const show = (value: string, currency: string): string => (value.trim() ? formatMoney({ currency, total: normalizeAmount(value) ?? value }) : '—');

/** Antes y después, solo de lo que cambia (el importe total siempre primero). Sin cambios ⇒ lista vacía. */
export function fareChanges(before: FareDraft, after: FareDraft, currency: string): Change[] {
  const rows: Array<[string, string, string]> = [
    ['Importe total', show(before.total, currency), show(after.total, currency)],
    ['Tasas incluidas', show(before.taxes, currency), show(after.taxes, currency)],
    ['Tarifa base (total − tasas)', show(derivedBase(before) ?? '', currency), show(derivedBase(after) ?? '', currency)],
    ['Reembolsable', yesNo(before.isRefundable), yesNo(after.isRefundable)],
    ['Permite cambios', yesNo(before.isChangeable), yesNo(after.isChangeable)],
    ['Artículo personal', yesNo(before.personalItemIncluded), yesNo(after.personalItemIncluded)],
    ['Equipaje de mano incluido', before.carryOnIncluded, after.carryOnIncluded],
    ['Maletas facturadas incluidas', before.checkedBaggageIncluded, after.checkedBaggageIncluded],
    ['Precio de la maleta extra', show(before.extraBaggage, currency), show(after.extraBaggage, currency)]
  ];
  return rows.filter(([, a, b]) => a !== b).map(([label, a, b]) => ({ label, before: a, after: b }));
}

export const fareKey = (fare: { flightInstanceId: string; cabinClass: string; fareBrand: string }): string => `${fare.flightInstanceId}|${fare.cabinClass}|${fare.fareBrand}`;
