import { NAME_CHAR_PATTERN, NAME_MAX_LENGTH } from '@flight-platform/format';
import type { DocumentType } from '@flight-platform/graphql-schema/generated/types';
import { documentRule } from './passenger-rules';
import { maxNationalDigits } from './phone';

/**
 * Filtrado de lo que se escribe o se pega en los campos (ADR-F12b1fix-05). Sin React ni DOM.
 * Nunca descarta en silencio: cuando quita algo, `blocked` trae la ayuda breve que la pantalla muestra junto al campo y anuncia a lectores de pantalla.
 */
export interface Filtered { value: string; /** Ayuda cuando se bloqueó algún carácter o se pasó del largo; `null` si todo se aceptó. */ blocked: string | null }
export type InputFilter = (raw: string) => Filtered;

const accept = (value: string): Filtered => ({ value, blocked: null });
/** Quita los caracteres que no cumplen `allowed`; devuelve la ayuda `onlyHelp` si quitó alguno, o la de largo si se pasó de `max`. */
function keep(raw: string, allowed: (char: string) => boolean, onlyHelp: string, max: number): Filtered {
  const chars = [...raw]; const kept = chars.filter(allowed);
  if (kept.length < chars.length) return { value: kept.slice(0, max).join(''), blocked: onlyHelp };
  if (kept.length > max) return { value: kept.slice(0, max).join(''), blocked: `Máximo ${max} ${max === 1 ? 'carácter' : 'caracteres'}.` };
  return accept(raw);
}

export const NAME_HELP = 'Solo letras, espacios, apóstrofo, guion y punto.';
/** Nombres y apellidos: solo los caracteres de la regla de Reservation (letras con tildes y ñ, marcas combinadas, espacios, apóstrofo, guion y punto), hasta 50. */
export const filterName: InputFilter = (raw) => keep(raw, (char) => NAME_CHAR_PATTERN.test(char), NAME_HELP, NAME_MAX_LENGTH);

const isDigit = (char: string): boolean => char >= '0' && char <= '9';
const isAlnum = (char: string): boolean => isDigit(char) || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');

/** Número nacional del teléfono: solo dígitos, con el tope que deja el E.164 para el país elegido. */
export const filterPhoneNational = (countryCode: string): InputFilter => (raw) => keep(raw, isDigit, 'Solo números.', maxNationalDigits(countryCode, [...raw].filter(isDigit).join('')));

/**
 * Número de documento según el TIPO y la NACIONALIDAD (`documentRule`): cédula con nacionalidad Ecuador, solo dígitos y hasta 10; en los demás casos, letras (sin tildes ni ñ)
 * y números, en mayúsculas, hasta 20. Pasar a mayúsculas no es descartar: no avisa.
 */
export const filterDocument = (type: DocumentType, nationality: string): InputFilter => (raw) => {
  const rule = documentRule(type, nationality);
  return rule.kind === 'ECUADOR_ID' ? keep(raw, isDigit, 'Solo números.', rule.max) : keep(raw.toUpperCase(), isAlnum, 'Solo letras (sin tildes) y números.', rule.max);
};

/**
 * Al cambiar el tipo o la nacionalidad, lo ya escrito se vuelve a filtrar con la regla nueva: si hay que quitar o recortar algo, el valor se ajusta Y se avisa
 * (`notice`, para la región anunciada del campo). Nunca se borra en silencio.
 */
export function adjustDocument(type: DocumentType, nationality: string, current: string): { value: string; notice: string | null } {
  const result = filterDocument(type, nationality)(current);
  return result.blocked ? { value: result.value, notice: `Ajustamos el número de documento a la regla elegida. ${result.blocked}` } : { value: result.value, notice: null };
}

/** Fecha escrita (dd/mm/aaaa): dígitos, con `/`, `-` y `.` como separadores (se reemplazan por la máscara); cualquier otra cosa se bloquea. */
export const filterDateText: InputFilter = (raw) => {
  const chars = [...raw]; const kept = chars.filter((char) => isDigit(char) || char === '/' || char === '-' || char === '.' || char === ' ');
  return kept.length < chars.length ? { value: kept.join(''), blocked: 'Solo números.' } : accept(raw);
};

/** Máscara dd/mm/aaaa sobre los dígitos escritos (hasta 8). */
export function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** ISO (AAAA-MM-DD) → «dd/mm/aaaa». */
export const isoToDisplay = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
/** «dd/mm/aaaa» → ISO si es una fecha de calendario que existe; si no, `null`. */
export function displayToIso(display: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display); if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${match[3]}-${match[2]}-${match[1]}` : null;
}
