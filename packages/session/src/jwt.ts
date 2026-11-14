/**
 * Lectura de los claims de un JWT SIN verificar la firma: solo para experiencia de usuario (mostrar el rol, saber si venció).
 * La barrera real son el servicio GraphQL y el Gateway, que validan la firma. Sin `atob`, `Buffer` ni `TextDecoder`: igual en web y React Native.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlToBytes(input: string): number[] | undefined {
  const bytes: number[] = []; let buffer = 0; let bits = 0;
  for (const char of input.replace(/=+$/, '')) {
    const value = ALPHABET.indexOf(char === '+' ? '-' : char === '/' ? '_' : char);
    if (value < 0) return undefined;
    buffer = (buffer << 6) | value; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
  }
  return bytes;
}

function utf8(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b < 0x80) out += String.fromCodePoint(b);
    else if (b < 0xe0) { out += String.fromCodePoint(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 1; }
    else if (b < 0xf0) { out += String.fromCodePoint(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 2; }
    else { out += String.fromCodePoint(((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)); i += 3; }
  }
  return out;
}

export type JwtClaims = Readonly<Record<string, unknown>>;

/** Claims del token, o un objeto vacío si no tiene forma de JWT. Nunca lanza. */
export function readClaims(token: string | null | undefined): JwtClaims {
  if (!token) return {};
  const segments = token.split('.');
  if (segments.length !== 3) return {};
  try {
    const bytes = base64UrlToBytes(segments[1]);
    if (!bytes) return {};
    const parsed: unknown = JSON.parse(utf8(bytes));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as JwtClaims) : {};
  } catch { return {}; }
}
