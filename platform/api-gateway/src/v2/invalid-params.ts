/**
 * Campos inválidos que un microservicio (Reservation) adjunta a un VALIDATION_FAILED (ADR-F12b1fix-05, punto 12). El Gateway los copia a
 * `invalidParams` del ProblemDetails v2 SIN valores: solo nombre de campo del contrato y motivo de una lista cerrada. Se vuelve a filtrar aquí
 * (el Gateway no confía en lo que le llega) con las mismas reglas que `packages/shared/src/invalid-params.ts`; el Gateway no depende de ese paquete.
 */
export const INVALID_PARAM_REASONS = ['REQUIRED', 'INVALID_FORMAT', 'OUT_OF_RANGE', 'AGE_NOT_ALLOWED_FOR_TYPE', 'DUPLICATED', 'INCONSISTENT'] as const;
export interface InvalidParam { name: string; reason: string }
export const INVALID_PARAMS_METADATA_KEY = 'invalid-params';
const NAME_PATTERN = /^passengers(?:\.(?:\d{1,2}|[A-Za-z][A-Za-z0-9]{0,39})){0,5}$/;
const MAX = 50;

export function safeInvalidParams(value: unknown): InvalidParam[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(); const result: InvalidParam[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, reason } = entry as { name?: unknown; reason?: unknown };
    if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof reason !== 'string' || !(INVALID_PARAM_REASONS as readonly string[]).includes(reason) || seen.has(name)) continue;
    seen.add(name); result.push({ name, reason });
    if (result.length >= MAX) break;
  }
  return result;
}

/** Transporte directo (`GATEWAY_TRANSPORT=grpc`): la lista viene en la metadata final del error del cliente gRPC. */
export function invalidParamsFromMetadata(source: unknown): InvalidParam[] {
  if (typeof source !== 'object' || source === null || typeof (source as { get?: unknown }).get !== 'function') return [];
  try {
    const [raw] = (source as { get(key: string): unknown[] }).get(INVALID_PARAMS_METADATA_KEY);
    return typeof raw === 'string' && raw.length <= 8192 ? safeInvalidParams(JSON.parse(raw)) : [];
  } catch { return []; }
}
