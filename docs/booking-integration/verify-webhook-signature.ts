import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica la cabecera `X-Flight-Signature: t=<unix>,v1=<hex>` de un webhook de Flight Platform.
 *
 * - `rawBody` es el texto EXACTO recibido; no lo reserialices desde un objeto JSON.
 * - `secret` es el que enviaste al registrar la suscripción (la API solo lo devuelve enmascarado).
 * - Cada reintento se firma con un `t` nuevo, así que la tolerancia se mide contra la hora de recepción.
 */
export function verifyFlightSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {}
): boolean {
  const { toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) } = options;
  if (!header) return false;
  const fields = new Map(
    header.split(',').map((part) => {
      const at = part.indexOf('=');
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    })
  );
  const timestamp = Number(fields.get('t'));
  const signature = fields.get('v1');
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
