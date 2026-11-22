import { Metadata } from '@grpc/grpc-js';
import type { RuleIssue } from './passenger-rules.js';

/**
 * Campos inválidos de una validación (ADR-F12b1fix-05, punto 12). Viajan por el error gRPC como metadata final (`invalid-params`, JSON),
 * el ESB los conserva en su sobre y el Gateway los copia a `invalidParams` del ProblemDetails v2 (que el contrato ya define).
 * NUNCA llevan el valor escrito ni datos personales: solo el nombre del campo (`passengers.<índice>.<campo>`) y un motivo de una lista cerrada.
 */
export const INVALID_PARAM_REASONS = ['REQUIRED', 'INVALID_FORMAT', 'OUT_OF_RANGE', 'AGE_NOT_ALLOWED_FOR_TYPE', 'DUPLICATED', 'INCONSISTENT'] as const;
export type InvalidParamReason = (typeof INVALID_PARAM_REASONS)[number];
export interface InvalidParam { name: string; reason: InvalidParamReason }

export const INVALID_PARAMS_METADATA_KEY = 'invalid-params';
export const MAX_INVALID_PARAMS = 50;
/** Solo campos de pasajeros del contrato: `passengers.0.firstName`, `passengers.2.contact.phone`, `passengers.1.extraBaggage.0.quantity`; `passengers` solo, para el conjunto. */
const NAME_PATTERN = /^passengers(?:\.(?:\d{1,2}|[A-Za-z][A-Za-z0-9]{0,39})){0,5}$/;

const isReason = (value: unknown): value is InvalidParamReason => typeof value === 'string' && (INVALID_PARAM_REASONS as readonly string[]).includes(value);

/** Deja pasar solo entradas con nombre de campo del contrato y motivo de la lista cerrada; sin repetidos y con tope. Lo demás se descarta. */
export function sanitizeInvalidParams(value: unknown): InvalidParam[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(); const result: InvalidParam[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, reason } = entry as { name?: unknown; reason?: unknown };
    if (typeof name !== 'string' || !NAME_PATTERN.test(name) || !isReason(reason) || seen.has(name)) continue;
    seen.add(name); result.push({ name, reason });
    if (result.length >= MAX_INVALID_PARAMS) break;
  }
  return result;
}

const REASON_BY_RULE: Readonly<Record<RuleIssue['code'], InvalidParamReason>> = {
  NAME_INVALID: 'INVALID_FORMAT', DOCUMENT_INVALID: 'INVALID_FORMAT', NATIONALITY_INVALID: 'INVALID_FORMAT', DATE_INVALID: 'INVALID_FORMAT', GENDER_INVALID: 'INVALID_FORMAT',
  EMAIL_INVALID: 'INVALID_FORMAT', PHONE_INVALID: 'INVALID_FORMAT', BIRTHDATE_FUTURE: 'OUT_OF_RANGE', AGE_MISMATCH: 'AGE_NOT_ALLOWED_FOR_TYPE',
  PASSENGER_ID_DUPLICATED: 'DUPLICATED', INFANT_ADULT_REQUIRED: 'INCONSISTENT', INFANT_ADULT_TAKEN: 'INCONSISTENT', INFANT_SEAT_NOT_ALLOWED: 'INCONSISTENT', COUNT_MISMATCH: 'INCONSISTENT'
};

/** Incumplimientos de las reglas compartidas → campos inválidos. Los del conjunto sin pasajero (conteos) se marcan como `passengers`. */
export function invalidParamsFromRuleIssues(issues: readonly RuleIssue[]): InvalidParam[] {
  return sanitizeInvalidParams(issues.map((issue) => ({ name: issue.index < 0 ? 'passengers' : `passengers.${issue.index}.${issue.field}`, reason: REASON_BY_RULE[issue.code] })));
}

/** Lo que se lee de un incumplimiento de Zod (sin su mensaje ni el valor). */
export interface ZodIssueLike { path: ReadonlyArray<PropertyKey>; code: string; origin?: string; minimum?: unknown; message?: string }

/** Incumplimientos de Zod → campos inválidos (solo los de `passengers.*`). El motivo sale del tipo de incumplimiento, nunca del valor. */
export function invalidParamsFromZodIssues(issues: readonly ZodIssueLike[]): InvalidParam[] {
  return sanitizeInvalidParams(issues.flatMap((issue) => {
    const path = issue.path.map(String);
    if (path[0] !== 'passengers' || path.length < 2) return [];
    // `unrecognized_keys` señala al padre: se marca el objeto, no un campo inventado.
    const missing = issue.code === 'invalid_type' && typeof issue.message === 'string' && /received undefined/.test(issue.message);
    const empty = issue.code === 'too_small' && issue.origin === 'string' && Number(issue.minimum) <= 1;
    const numeric = (issue.code === 'too_small' || issue.code === 'too_big') && (issue.origin === 'number' || issue.origin === 'int');
    return [{ name: path.join('.'), reason: missing || empty ? 'REQUIRED' : numeric ? 'OUT_OF_RANGE' : 'INVALID_FORMAT' }];
  }));
}

export function invalidParamsToMetadata(params: readonly InvalidParam[]): Metadata {
  const metadata = new Metadata();
  const safe = sanitizeInvalidParams(params);
  if (safe.length) metadata.set(INVALID_PARAMS_METADATA_KEY, JSON.stringify(safe));
  return metadata;
}

/** Lee la lista de la metadata final de un error gRPC (cliente o servidor); lo que no cumple el formato se descarta. */
export function invalidParamsFromMetadata(source: unknown): InvalidParam[] {
  if (typeof source !== 'object' || source === null || typeof (source as { get?: unknown }).get !== 'function') return [];
  try {
    const [raw] = (source as { get(key: string): unknown[] }).get(INVALID_PARAMS_METADATA_KEY);
    return typeof raw === 'string' && raw.length <= 8192 ? sanitizeInvalidParams(JSON.parse(raw)) : [];
  } catch { return []; }
}
