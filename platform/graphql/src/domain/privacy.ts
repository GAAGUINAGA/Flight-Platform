/** Enmascarado de documento: solo salen los últimos caracteres; el número completo no sale del servicio. */
export function maskDocument(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '****';
  const visible = value.length > 6 ? 3 : value.length > 3 ? 2 : 0;
  return `${'*'.repeat(Math.max(4, value.length - visible))}${visible ? value.slice(-visible) : ''}`;
}

/** Id de correlación: se conserva si es seguro; si falta, supera 100 caracteres o tiene caracteres raros, se reemplaza. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/;
export const isSafeCorrelationId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
/** La huella del dispositivo se valida (≤128, caracteres seguros) antes de reenviarla. */
export const isSafeFingerprint = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);

/** Campos que nunca van a los registros (PLAN §2.4): documentación de la lista blanca, que es la que manda. */
export const SENSITIVE_FIELDS = ['documentNumber', 'email', 'phone', 'firstName', 'lastName', 'authorization', 'secret', 'paymentReference', 'variables', 'query'] as const;
