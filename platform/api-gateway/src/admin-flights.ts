import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { localToUtc, zoneOf, localTime, localDay } from '@flight-platform/shared';
import { z } from 'zod';
import type { AdminFlightRules } from './config';

/**
 * Crear un vuelo con su tarifa (F12c-4c, ADR-F12c4-01 P6 y adenda 4b/4c). Funciones PURAS: validan, convierten la hora local a UTC y arman el plan
 * (vuelo cerrado + una tarifa por cabina y marca). No llaman a nadie; la orquestación (crear cerrado → guardar y releer tarifas → abrir) vive en el Gateway.
 */
export const DEFAULT_FLIGHT_RULES: AdminFlightRules = { airlinePrefix: 'FP', minLeadMinutes: 60, maxDaysAhead: 400, minDurationMinutes: 20, maxDurationMinutes: 1200, currencies: ['USD'] };

export const CABIN_ORDER = ['FIRST', 'BUSINESS', 'PREMIUM_ECONOMY', 'ECONOMY'] as const;
const cabin = z.enum(CABIN_ORDER);
const amount = z.string().regex(/^\d{1,7}\.\d{2}$/);
const fareSchema = z.object({
  cabinClass: cabin, fareBrand: z.string().trim().min(1).max(32),
  baseFare: amount, taxes: amount, currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  isRefundable: z.boolean(), isChangeable: z.boolean(),
  carryOnIncluded: z.number().int().min(0).max(9), checkedBaggageIncluded: z.number().int().min(0).max(9),
  extraBaggagePrice: amount
}).strict();
export const createFlightSchema = z.object({
  flightNumber: z.string().regex(/^[A-Z0-9]{2}[0-9]{1,4}$/),
  origin: z.string().regex(/^[A-Z]{3}$/), destination: z.string().regex(/^[A-Z]{3}$/),
  /** Hora civil LOCAL del aeropuerto de origen, `YYYY-MM-DDTHH:mm` (sin desplazamiento): la conversión a UTC la hace el servidor. */
  departureLocal: z.string(),
  durationMinutes: z.number().int(),
  aircraft: z.string().regex(/^[A-Z0-9-]{2,32}$/),
  fares: z.array(fareSchema).min(1).max(16),
  openForSale: z.boolean().optional()
}).strict();
export type CreateFlightInput = z.output<typeof createFlightSchema>;
export const idempotencyKeyFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AircraftLayout { code: string; cabins: Array<{ cabinClass: string; seats: number }> }
/** Un error por campo: `name` es la ruta del campo y `reason` un código estable; JAMÁS el valor enviado. */
export interface InvalidParam { name: string; reason: string }

const cents = (value: string): number => Number(value.replace('.', ''));
export const fromCents = (value: number): string => (value / 100).toFixed(2);

export interface PlannedFare {
  cabinClass: string; fareBrand: string; baseFare: string; taxes: string; total: string; currency: string;
  isRefundable: boolean; isChangeable: boolean; carryOnIncluded: number; checkedBaggageIncluded: number; extraBaggagePrice: string;
}
export interface FlightPlan {
  flightNumber: string; origin: string; destination: string; aircraft: string; durationMinutes: number;
  departureAt: Date; arrivalAt: Date; departureLocal: string; arrivalLocal: string;
  cabins: Array<{ cabinClass: string; capacity: number }>; fares: PlannedFare[]; openForSale: boolean;
}

/** Nombre → UUID v5 (RFC 4122) en un espacio de nombres propio: el id de la instancia sale de la Idempotency-Key, así reintentar retoma el mismo vuelo. */
const NAMESPACE = Buffer.from('7f1c6d2e4b8a4e0c9a35d1f0b6c2e8a4', 'hex');
export function uuidV5(name: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16)); bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const flightIdFromKey = (adminSub: string, key: string): string => uuidV5(`admin-create-flight:${adminSub}:${key.toLowerCase()}`);

/** Lo mínimo que el registro necesita aunque el cuerpo sea inválido: el número de vuelo SOLO si tiene el formato (si no, el sujeto queda nulo). */
export function flightNumberOf(body: unknown): string | null {
  const value = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as { flightNumber?: unknown }).flightNumber : undefined;
  return typeof value === 'string' && /^[A-Z0-9]{2}[0-9]{1,4}$/.test(value) ? value : null;
}

const issueName = (path: PropertyKey[]): string => path.map(String).join('.') || 'body';

/**
 * Valida el cuerpo y las reglas de negocio (P6) contra el catálogo de aviones y devuelve el plan o la lista de errores por campo.
 * Reglas: prefijo de aerolínea, aeropuertos conocidos y distintos, hora local existente y no ambigua, anticipación (60 min – 400 días), duración
 * (20 min – 20 h), avión del catálogo, una tarifa por cabina y marca (todas las cabinas del avión con al menos una), moneda permitida, total > 0.
 */
export function planFlight(body: unknown, rules: AdminFlightRules, catalog: AircraftLayout[], now: Date): { plan: FlightPlan } | { errors: InvalidParam[] } {
  const parsed = createFlightSchema.safeParse(body);
  if (!parsed.success) {
    const names = new Set<string>();
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') for (const key of issue.keys) names.add([...issue.path, key].map(String).join('.'));
      else names.add(issueName(issue.path));
    }
    return { errors: [...names].map((name) => ({ name, reason: 'invalid' })) };
  }
  const input = parsed.data; const errors: InvalidParam[] = [];
  if (!input.flightNumber.startsWith(rules.airlinePrefix)) errors.push({ name: 'flightNumber', reason: 'airline-prefix' });
  const originZone = zoneOf(input.origin); const destinationZone = zoneOf(input.destination);
  if (!originZone) errors.push({ name: 'origin', reason: 'airport-unknown' });
  if (!destinationZone) errors.push({ name: 'destination', reason: 'airport-unknown' });
  if (input.origin === input.destination) errors.push({ name: 'destination', reason: 'same-as-origin' });
  if (input.durationMinutes < rules.minDurationMinutes || input.durationMinutes > rules.maxDurationMinutes) errors.push({ name: 'durationMinutes', reason: 'duration-out-of-range' });
  let departureAt: Date | undefined;
  if (originZone) {
    const converted = localToUtc(input.departureLocal, originZone);
    if (!converted.ok) errors.push({ name: 'departureLocal', reason: converted.reason === 'invalid' ? 'invalid' : `local-time-${converted.reason}` });
    else {
      departureAt = converted.instant;
      const minutesAhead = (departureAt.getTime() - now.getTime()) / 60_000;
      if (minutesAhead < rules.minLeadMinutes) errors.push({ name: 'departureLocal', reason: 'too-soon' });
      else if (minutesAhead > rules.maxDaysAhead * 1440) errors.push({ name: 'departureLocal', reason: 'too-far' });
    }
  }
  const layout = catalog.find((value) => value.code === input.aircraft);
  if (!layout) errors.push({ name: 'aircraft', reason: 'aircraft-not-supported' });
  const seen = new Set<string>(); const fares: PlannedFare[] = [];
  input.fares.forEach((fare, index) => {
    const name = `fares.${index}`; const currency = fare.currency ?? 'USD';
    if (!rules.currencies.includes(currency)) errors.push({ name: `${name}.currency`, reason: 'currency-not-allowed' });
    if (layout && !layout.cabins.some((value) => value.cabinClass === fare.cabinClass)) errors.push({ name: `${name}.cabinClass`, reason: 'cabin-not-in-aircraft' });
    const identity = `${fare.cabinClass}|${fare.fareBrand.toLowerCase()}`;
    if (seen.has(identity)) errors.push({ name: `${name}.fareBrand`, reason: 'duplicate-brand' }); seen.add(identity);
    const total = cents(fare.baseFare) + cents(fare.taxes);
    if (total <= 0) errors.push({ name: `${name}.baseFare`, reason: 'total-not-positive' });
    fares.push({ cabinClass: fare.cabinClass, fareBrand: fare.fareBrand, baseFare: fare.baseFare, taxes: fare.taxes, total: fromCents(total), currency, isRefundable: fare.isRefundable, isChangeable: fare.isChangeable, carryOnIncluded: fare.carryOnIncluded, checkedBaggageIncluded: fare.checkedBaggageIncluded, extraBaggagePrice: fare.extraBaggagePrice });
  });
  if (layout) {
    for (const value of layout.cabins) {
      const count = input.fares.filter((fare) => fare.cabinClass === value.cabinClass).length;
      if (count === 0) errors.push({ name: 'fares', reason: `missing-fare-${value.cabinClass}` });
      if (count > 4) errors.push({ name: 'fares', reason: `too-many-fares-${value.cabinClass}` });
    }
  }
  if (errors.length || !departureAt || !layout || !destinationZone) return { errors };
  const arrivalAt = new Date(departureAt.getTime() + input.durationMinutes * 60_000);
  const local = (instant: Date, zone: string) => `${localDay(instant, zone)}T${localTime(instant, zone)}`;
  return {
    plan: {
      flightNumber: input.flightNumber, origin: input.origin, destination: input.destination, aircraft: input.aircraft, durationMinutes: input.durationMinutes,
      departureAt, arrivalAt, departureLocal: local(departureAt, originZone as string), arrivalLocal: local(arrivalAt, destinationZone),
      cabins: layout.cabins.map((value) => ({ cabinClass: value.cabinClass, capacity: value.seats })), fares, openForSale: input.openForSale === true
    }
  };
}

/** El cuerpo de `PUT /fares` (esquema `adminFareBody`) de una tarifa planificada. */
export const fareRequest = (flightInstanceId: string, fare: PlannedFare) => ({
  flightInstanceId, cabinClass: fare.cabinClass, fareBrand: fare.fareBrand,
  price: { currency: fare.currency, baseFare: fare.baseFare, taxes: fare.taxes, total: fare.total },
  fareRules: { isRefundable: fare.isRefundable, isChangeable: fare.isChangeable },
  baggageAllowance: { carryOnIncluded: fare.carryOnIncluded, checkedBaggageIncluded: fare.checkedBaggageIncluded },
  extraCheckedBaggagePrice: { currency: fare.currency, total: fare.extraBaggagePrice }
});

interface StoredFare { cabinClass?: string; fareBrand?: string; price?: { currency?: string; total?: string; baseFare?: string; taxes?: string }; fareRules?: { isRefundable?: boolean; isChangeable?: boolean }; baggageAllowance?: { carryOnIncluded?: number; checkedBaggageIncluded?: number }; extraCheckedBaggagePrice?: { total?: string } }
/** Las tarifas que `ListFares` devolvió (cualquier forma de la respuesta del servicio). */
export function storedFares(response: unknown): StoredFare[] {
  const list = (response as { fares?: Array<{ fare?: StoredFare }> } | undefined)?.fares;
  return Array.isArray(list) ? list.map((entry) => entry.fare ?? {}) : [];
}
/** ¿Todas las tarifas planificadas están guardadas EXACTAMENTE como se enviaron? (se relee y se compara; nunca se confía en que el guardado salió bien) */
export function faresMatch(expected: PlannedFare[], stored: StoredFare[]): boolean {
  return expected.every((fare) => stored.some((value) => value.cabinClass === fare.cabinClass && value.fareBrand === fare.fareBrand && value.price?.total === fare.total && value.price?.baseFare === fare.baseFare && value.price?.taxes === fare.taxes
    && value.fareRules?.isRefundable === fare.isRefundable && value.fareRules?.isChangeable === fare.isChangeable && value.baggageAllowance?.carryOnIncluded === fare.carryOnIncluded
    && value.baggageAllowance?.checkedBaggageIncluded === fare.checkedBaggageIncluded && value.extraCheckedBaggagePrice?.total === fare.extraBaggagePrice));
}
/** ¿La tarifa GUARDADA es válida? USD, base + tasas = total > 0, reglas y equipaje presentes (se juzga lo releído de Pricing, nunca lo que diga el panel). */
export function isValidStoredFare(fare: StoredFare): boolean {
  const amount = /^\d{1,7}\.\d{2}$/; const { currency, total, baseFare, taxes } = fare.price ?? {};
  if (currency !== 'USD' || !total || !baseFare || !taxes || !amount.test(total) || !amount.test(baseFare) || !amount.test(taxes)) return false;
  if (cents(baseFare) + cents(taxes) !== cents(total) || cents(total) <= 0) return false;
  const bag = fare.baggageAllowance; const extra = fare.extraCheckedBaggagePrice?.total;
  return typeof fare.fareBrand === 'string' && fare.fareBrand !== '' && typeof fare.fareRules?.isRefundable === 'boolean' && typeof fare.fareRules?.isChangeable === 'boolean'
    && Number.isInteger(bag?.carryOnIncluded) && Number.isInteger(bag?.checkedBaggageIncluded) && typeof extra === 'string' && amount.test(extra);
}
/**
 * LA comprobación única antes de abrir (creación con `openForSale` y OPEN_FLIGHT manual): cada cabina con asientos debe tener al menos una tarifa guardada y válida.
 * Devuelve las cabinas que faltan (vacío = lista para abrir), en el orden del vuelo.
 */
export const cabinsMissingFares = (cabins: Array<{ cabinClass: string; capacity: number }>, stored: StoredFare[]): string[] =>
  cabins.filter((value) => value.capacity > 0 && !stored.some((fare) => fare.cabinClass === value.cabinClass && isValidStoredFare(fare))).map((value) => value.cabinClass);
/** ¿Cada cabina con asientos tiene al menos una tarifa guardada y válida? */
export const cabinsAllHaveFares = (cabins: Array<{ cabinClass: string; capacity: number }>, stored: StoredFare[]): boolean => cabinsMissingFares(cabins, stored).length === 0;
