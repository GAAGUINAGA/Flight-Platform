/**
 * Único lugar donde se traducen los estados y campos de la API de pagos de Booking a los tres resultados que usa la saga.
 * El formato real de `GET /pagos/{paymentReference}` se confirma en la reunión: cambiarlo es solo configuración
 * (`BOOKING_PAYMENTS_STATUS_MAP`, `BOOKING_PAYMENTS_FIELDS`), sin tocar el adaptador.
 */
export type PaymentOutcome = 'CONFIRMED' | 'PENDING' | 'FAILED';

export interface PaymentFields { status: string[]; amount: string[]; currency: string[]; }
export type StatusMap = Record<PaymentOutcome, string[]>;

export const DEFAULT_STATUS_MAP: StatusMap = {
  CONFIRMED: ['CONFIRMED', 'CONFIRMADO', 'CONFIRMADA', 'PAID', 'PAGADO', 'APPROVED', 'APROBADO', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETADO'],
  PENDING: ['PENDING', 'PENDIENTE', 'PROCESSING', 'EN_PROCESO', 'AUTHORIZED_PENDING', 'IN_PROGRESS'],
  FAILED: ['FAILED', 'FALLIDO', 'FALLIDA', 'REJECTED', 'RECHAZADO', 'DECLINED', 'DENIED', 'CANCELLED', 'CANCELED', 'CANCELADO', 'EXPIRED', 'EXPIRADO', 'REFUNDED', 'REEMBOLSADO', 'ERROR']
};
export const DEFAULT_FIELDS: PaymentFields = { status: ['estado', 'status', 'state'], amount: ['monto', 'amount', 'total', 'importe'], currency: ['moneda', 'currency'] };

const normalize = (value: string): string => value.trim().toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\s-]+/g, '_');

/** Estado desconocido → `undefined`: el llamador decide (por seguridad se trata como no autorizado). */
export function classifyStatus(raw: unknown, map: StatusMap = DEFAULT_STATUS_MAP): PaymentOutcome | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = normalize(raw);
  for (const outcome of ['CONFIRMED', 'PENDING', 'FAILED'] as const) if (map[outcome].some((candidate) => normalize(candidate) === value)) return outcome;
  return undefined;
}

const parseJson = (raw: string | undefined, name: string): unknown => { if (!raw) return undefined; try { return JSON.parse(raw); } catch { throw new Error(`${name} must be valid JSON`); } };
const stringList = (value: unknown, name: string): string[] => { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) throw new Error(`${name} must be an array of strings`); return value as string[]; };

export function parseStatusMap(raw: string | undefined): StatusMap {
  const parsed = parseJson(raw, 'BOOKING_PAYMENTS_STATUS_MAP') as Partial<Record<PaymentOutcome, unknown>> | undefined;
  if (!parsed) return DEFAULT_STATUS_MAP;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('BOOKING_PAYMENTS_STATUS_MAP must be an object');
  return { CONFIRMED: parsed.CONFIRMED ? stringList(parsed.CONFIRMED, 'CONFIRMED') : DEFAULT_STATUS_MAP.CONFIRMED, PENDING: parsed.PENDING ? stringList(parsed.PENDING, 'PENDING') : DEFAULT_STATUS_MAP.PENDING, FAILED: parsed.FAILED ? stringList(parsed.FAILED, 'FAILED') : DEFAULT_STATUS_MAP.FAILED };
}
export function parseFields(raw: string | undefined): PaymentFields {
  const parsed = parseJson(raw, 'BOOKING_PAYMENTS_FIELDS') as Partial<Record<keyof PaymentFields, unknown>> | undefined;
  if (!parsed) return DEFAULT_FIELDS;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('BOOKING_PAYMENTS_FIELDS must be an object');
  return { status: parsed.status ? stringList(parsed.status, 'status') : DEFAULT_FIELDS.status, amount: parsed.amount ? stringList(parsed.amount, 'amount') : DEFAULT_FIELDS.amount, currency: parsed.currency ? stringList(parsed.currency, 'currency') : DEFAULT_FIELDS.currency };
}

/** Primer campo presente entre los alias; admite que la respuesta venga envuelta en `data` o `payment`/`pago`. */
export function pickField(body: unknown, aliases: string[]): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  for (const alias of aliases) if (record[alias] !== undefined && record[alias] !== null) return record[alias];
  for (const wrapper of ['data', 'payment', 'pago']) { const inner = record[wrapper]; if (inner && typeof inner === 'object' && !Array.isArray(inner)) { const found = pickField(inner, aliases); if (found !== undefined) return found; } }
  return undefined;
}
