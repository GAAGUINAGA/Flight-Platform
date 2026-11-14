import { formatDate, isIsoDate } from '@flight-platform/format';
import type { CabinClass, PromotionAgreementInput, PromotionFieldsFragment } from '@flight-platform/graphql-schema/generated/types';
import type { Change } from './fare-rules';
import { CABINS, CABIN_LABEL } from './fare-rules';

/** Reglas del acuerdo de promociones de la aerolínea (v2): validación antes de enviar y diferencias para la confirmación. Sin React ni DOM. */
export interface PromotionDraft { allowsPromotions: boolean; maxDiscountPercent: string; destinations: string; routes: string; cabins: CabinClass[]; validUntil: string; conditions: string }
export type PromotionErrors = Partial<Record<keyof PromotionDraft, string>>;

export const DISCOUNT_MIN = 0; export const DISCOUNT_MAX = 100; export const CONDITIONS_MAX = 500;
const ROUTE = /^[A-Z]{3}-[A-Z]{3}$/;

/** «UIO-GYE, gye-uio» o una por línea → `['UIO-GYE', 'GYE-UIO']`. */
export const splitList = (text: string): string[] => text.split(/[\n,;]+/).map((entry) => entry.trim()).filter(Boolean);

export function emptyPromotion(): PromotionDraft { return { allowsPromotions: true, maxDiscountPercent: '', destinations: '', routes: '', cabins: [], validUntil: '', conditions: '' }; }
export function draftFromAgreement(agreement: PromotionFieldsFragment): PromotionDraft {
  return {
    allowsPromotions: agreement.allowsPromotions, maxDiscountPercent: String(agreement.maxDiscountPercent), destinations: (agreement.destinations ?? []).join(', '), routes: (agreement.routes ?? []).join(', '),
    cabins: agreement.cabins ?? [], validUntil: agreement.validUntil ?? '', conditions: agreement.conditions ?? ''
  };
}

/** El porcentaje escrito («12», «12,5», «12.50»); `null` si no es un número. */
export function parseDiscount(text: string): number | null {
  const value = text.trim().replace(',', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return null;
  return Number(value);
}

export function validatePromotion(draft: PromotionDraft): PromotionErrors {
  const errors: PromotionErrors = {};
  const percent = parseDiscount(draft.maxDiscountPercent);
  if (percent === null) errors.maxDiscountPercent = `Escribe un porcentaje entre ${DISCOUNT_MIN} y ${DISCOUNT_MAX}, por ejemplo 15 o 12,5.`;
  else if (percent < DISCOUNT_MIN || percent > DISCOUNT_MAX) errors.maxDiscountPercent = `El descuento máximo debe estar entre ${DISCOUNT_MIN} y ${DISCOUNT_MAX}.`;
  const routes = splitList(draft.routes).map((route) => route.toUpperCase());
  if (routes.length > 100) errors.routes = 'Hasta 100 rutas.';
  else if (routes.some((route) => !ROUTE.test(route))) errors.routes = 'Cada ruta lleva dos códigos IATA separados por guion, por ejemplo UIO-GYE.';
  const destinations = splitList(draft.destinations);
  if (destinations.length > 50) errors.destinations = 'Hasta 50 destinos.';
  else if (destinations.some((destination) => destination.length > 60)) errors.destinations = 'Cada destino admite hasta 60 caracteres.';
  if (draft.validUntil && !isIsoDate(draft.validUntil)) errors.validUntil = 'Escribe una fecha válida.';
  if (draft.conditions.length > CONDITIONS_MAX) errors.conditions = `Las condiciones admiten hasta ${CONDITIONS_MAX} caracteres.`;
  return errors;
}

/** Entrada de `setPromotionAgreement`. Se asume el borrador ya validado. */
export function toPromotionInput(draft: PromotionDraft): PromotionAgreementInput {
  const destinations = splitList(draft.destinations); const routes = splitList(draft.routes).map((route) => route.toUpperCase());
  return {
    allowsPromotions: draft.allowsPromotions, maxDiscountPercent: parseDiscount(draft.maxDiscountPercent) ?? 0,
    destinations, routes, cabins: CABINS.filter((cabin) => draft.cabins.includes(cabin)),
    ...(draft.validUntil ? { validUntil: draft.validUntil } : {}), ...(draft.conditions.trim() ? { conditions: draft.conditions.trim() } : {})
  };
}

const list = (values: string[]): string => (values.length > 0 ? values.join(', ') : '—');
const summary = (draft: PromotionDraft): Array<[string, string]> => {
  const percent = parseDiscount(draft.maxDiscountPercent);
  return [
    ['Permite promociones', draft.allowsPromotions ? 'Sí' : 'No'], ['Descuento máximo', percent === null ? '—' : `${percent} %`],
    ['Destinos', list(splitList(draft.destinations))], ['Rutas', list(splitList(draft.routes).map((route) => route.toUpperCase()))],
    ['Cabinas', list(CABINS.filter((cabin) => draft.cabins.includes(cabin)).map((cabin) => CABIN_LABEL[cabin]))],
    ['Vigencia hasta', draft.validUntil ? formatDate(draft.validUntil) : '—'], ['Condiciones', draft.conditions.trim() || '—']
  ];
};

/** Antes y después de lo que cambia. Sin acuerdo previo (`before = null`) se listan todos los campos como nuevos. */
export function promotionChanges(before: PromotionDraft | null, after: PromotionDraft): Change[] {
  const next = summary(after); const previous = before ? summary(before) : null;
  return next.flatMap(([label, value], index) => (previous && previous[index][1] === value ? [] : [{ label, before: previous ? previous[index][1] : '—', after: value }]));
}
