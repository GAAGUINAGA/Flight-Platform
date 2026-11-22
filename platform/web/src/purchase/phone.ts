import { countryByCode, E164_MAX_DIGITS, PHONE_PATTERN } from '@flight-platform/format';
import { isSupportedCountry, parsePhoneNumberFromString, validatePhoneNumberLength, type CountryCode } from 'libphonenumber-js/min';

/**
 * Teléfono de contacto = país elegido + número NACIONAL, tal como lo escribe la persona en su país (ADR-F12b1fix-05, punto 13). Sin React ni DOM.
 * `libphonenumber-js` (metadatos «min») valida el número PARA ESE PAÍS y arma el E.164; así el 0 troncal y el largo de cada país no son una lista mantenida a mano.
 * La regla del servidor no cambia: Reservation recibe un E.164 (`PHONE_PATTERN`).
 */
export type PhoneStatus = 'EMPTY' | 'VALID' | 'INVALID';
export interface PhoneResult { status: PhoneStatus; /** E.164 si es válido; vacío en cualquier otro caso. */ e164: string }

const digitsOf = (value: string): string => value.replace(/\D/g, '');

/**
 * Valida el número nacional para el país y lo compone en E.164. Un número que la librería interpretaría como de OTRO país (p. ej. «00» + código: prefijo internacional)
 * no vale: el país ya está elegido. Un país sin metadatos se valida solo con el E.164 (`PHONE_PATTERN`).
 */
export function resolvePhone(countryCode: string, national: string): PhoneResult {
  const digits = digitsOf(national);
  if (!digits) return { status: 'EMPTY', e164: '' };
  const country = countryByCode(countryCode);
  if (!country) return { status: 'INVALID', e164: '' };
  if (!isSupportedCountry(countryCode)) {
    const e164 = `+${country.dial}${digits}`;
    return PHONE_PATTERN.test(e164) ? { status: 'VALID', e164 } : { status: 'INVALID', e164: '' };
  }
  const parsed = parsePhoneNumberFromString(digits, countryCode as CountryCode);
  if (parsed && parsed.isValid() && parsed.countryCallingCode === country.dial && PHONE_PATTERN.test(parsed.number)) return { status: 'VALID', e164: parsed.number };
  return { status: 'INVALID', e164: '' };
}

/** E.164 del teléfono (vacío si falta o no es válido para el país). */
export const phoneE164 = (countryCode: string, national: string): string => resolvePhone(countryCode, national).e164;

/**
 * Máximo de dígitos que se pueden escribir como número nacional: el mayor largo que la librería no da por demasiado largo para el país. Si lo escrito empieza con 0 se mide
 * con ese 0 (el prefijo troncal que la librería quita en los países que lo usan cuenta al escribir, no al componer). Sin metadatos del país, lo que deja el E.164 tras
 * el código de marcación.
 */
export function maxNationalDigits(countryCode: string, national = ''): number {
  const country = countryByCode(countryCode);
  if (!country) return E164_MAX_DIGITS;
  const fallback = E164_MAX_DIGITS - country.dial.length;
  if (!isSupportedCountry(countryCode)) return fallback;
  const lead = digitsOf(national).startsWith('0') ? '0' : '9';
  // Sin 0 inicial nunca se pasa de lo que deja el E.164; con él cabe uno más (el prefijo troncal se quita al componer en los países que lo usan; si el país no lo usa, la validación lo rechaza).
  for (let length = lead === '0' ? fallback + 1 : fallback; length > 1; length -= 1) {
    if (validatePhoneNumberLength(`${lead}${'9'.repeat(length - 1)}`, countryCode as CountryCode) !== 'TOO_LONG') return length;
  }
  return fallback;
}
