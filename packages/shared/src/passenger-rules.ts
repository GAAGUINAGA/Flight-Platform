/**
 * Reglas de los pasajeros: ÚNICA fuente (ADR-F12b1fix-05). Sin importaciones ni DOM ni NestJS: las usan Reservation (que es la autoridad, a través de
 * `@flight-platform/shared`) y la web (por la subruta `@flight-platform/shared/dist/src/passenger-rules`, que en el front se resuelve al código fuente).
 *
 * Los mensajes están en español y NUNCA incluyen el valor escrito (puede ser un documento, un nombre o un contacto).
 * Reservation solo usa `code`/`field`/`index` y responde VALIDATION_FAILED; la web muestra `message` junto al campo.
 */

export type PassengerType = 'ADULT' | 'YOUTH' | 'CHILD' | 'INFANT';

/** Límites de los campos de texto. */
export const NAME_MAX_LENGTH = 50;
export const DOCUMENT_MIN_LENGTH = 5;
export const DOCUMENT_MAX_LENGTH = 20;

/**
 * Nombres y apellidos: letras Unicode (con tildes y ñ), marcas combinadas, espacios simples, apóstrofo, guion y punto; empieza con una letra;
 * 1 a 50 caracteres tras recortar; sin dígitos ni otros símbolos. Se acepta el apóstrofo tipográfico (’) porque así lo escriben los teclados móviles.
 */
export const NAME_PATTERN = /^\p{L}[\p{L}\p{M}'’. -]*$/u;
/** Un carácter permitido en un nombre (la web bloquea al teclear y al pegar los que no cumplan; una prueba comprueba que coincide con `NAME_PATTERN`). */
export const NAME_CHAR_PATTERN = /[\p{L}\p{M}'’. -]/u;
/** Documento (cédula o pasaporte): solo letras y números, de 5 a 20. */
export const DOCUMENT_PATTERN = /^[A-Za-z0-9]{5,20}$/;
/** Teléfono: E.164 estricto (`+` y código de país, sin espacios ni signos). */
export const PHONE_PATTERN = /^\+[1-9]\d{1,14}$/;
/** El mismo patrón de correo que `z.string().email()` de Zod 4 (una prueba de Reservation los compara). */
export const EMAIL_PATTERN = /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
/** Nacionalidad: código de país de 2 o 3 letras (lo que acepta Reservation; la web envía el de 2 letras de su lista). */
export const NATIONALITY_LENGTH = { min: 2, max: 3 } as const;
export const GENDERS = ['M', 'F', 'X'] as const;

/** Nombres: recorta y colapsa los espacios repetidos (la web lo aplica al salir del campo; el servidor exige espacios simples). */
export const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ');
/** Documento: quita espacios y guiones y pasa a mayúsculas. Cualquier otro carácter se deja para que la validación lo rechace. */
export const normalizeDocument = (value: string): string => value.replace(/[\s-]/g, '').toUpperCase();
/** Teléfono: quita espacios, guiones, puntos y paréntesis. NO inventa el código de país: sin `+` la validación lo pide. */
export const normalizePhone = (value: string): string => value.trim().replace(/[\s().-]/g, '');

export const isValidName = (value: string): boolean => { const name = value.trim(); return name.length >= 1 && name.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(name) && !/ {2}/.test(name); };

/** Fecha de calendario AAAA-MM-DD que existe (equivale a `z.string().date()`). */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Años cumplidos de `birthDate` (AAAA-MM-DD) en el instante `at`, en UTC (así los mide Reservation). Negativo = fecha futura. */
export function ageAt(birthDate: string, at: Date): number {
  const birthday = new Date(`${birthDate}T00:00:00.000Z`);
  let years = at.getUTCFullYear() - birthday.getUTCFullYear();
  if (at.getUTCMonth() < birthday.getUTCMonth() || (at.getUTCMonth() === birthday.getUTCMonth() && at.getUTCDate() < birthday.getUTCDate())) years -= 1;
  return years;
}

/** Rango de edad (años cumplidos a la fecha de la compra) de cada tipo: INFANT < 2, CHILD 2–11, YOUTH 12–17, ADULT ≥ 18 (regla de Reservation; PLAN Q-010 difiere, ver ADR-F12b1fix-05). */
export const AGE_RANGES: Readonly<Record<PassengerType, { min: number; max: number }>> = { INFANT: { min: 0, max: 1 }, CHILD: { min: 2, max: 11 }, YOUTH: { min: 12, max: 17 }, ADULT: { min: 18, max: Number.POSITIVE_INFINITY } };
export const validAge = (type: PassengerType, years: number): boolean => years >= AGE_RANGES[type].min && years <= AGE_RANGES[type].max;
export const PASSENGER_TYPE_NOUN: Readonly<Record<PassengerType, string>> = { ADULT: 'adulto', YOUTH: 'joven', CHILD: 'niño', INFANT: 'infante' };

export type RuleCode =
  | 'NAME_INVALID' | 'DOCUMENT_INVALID' | 'NATIONALITY_INVALID' | 'DATE_INVALID' | 'BIRTHDATE_FUTURE' | 'AGE_MISMATCH' | 'GENDER_INVALID'
  | 'EMAIL_INVALID' | 'PHONE_INVALID' | 'PASSENGER_ID_DUPLICATED' | 'INFANT_ADULT_REQUIRED' | 'INFANT_ADULT_TAKEN' | 'INFANT_SEAT_NOT_ALLOWED' | 'COUNT_MISMATCH';

/** Un incumplimiento. `index` es la posición del pasajero (−1 si es de todo el conjunto); `field` usa los nombres del contrato (`contact.email`, `contact.phone`). */
export interface RuleIssue { index: number; field: string; code: RuleCode; message: string }

/** Lo que las reglas leen de un pasajero (cada capa lo adapta desde su propia forma). */
export interface PassengerFacts {
  passengerId: string;
  passengerType: PassengerType;
  associatedAdultId?: string | null;
  firstName?: string;
  lastName?: string;
  documentNumber?: string;
  nationality?: string;
  documentExpiryDate?: string | null;
  birthDate: string;
  gender?: string;
  email?: string;
  phone?: string;
  assignedSeats?: ReadonlyArray<unknown> | null;
}
export interface PassengerBreakdown { adults: number; youths: number; children: number; infants: number }

const MESSAGES = {
  firstName: 'Escribe los nombres solo con letras, espacios, apóstrofo, guion o punto (hasta 50 caracteres).',
  lastName: 'Escribe los apellidos solo con letras, espacios, apóstrofo, guion o punto (hasta 50 caracteres).',
  documentNumber: 'Escribe el número del documento: entre 5 y 20 letras o números, sin espacios ni guiones.',
  nationality: 'Elige la nacionalidad.',
  date: 'Escribe una fecha válida.',
  birthMissing: 'Escribe la fecha de nacimiento.',
  future: 'La fecha de nacimiento no puede ser futura.',
  gender: 'Elige el género.',
  email: 'Escribe un correo electrónico válido.',
  phone: 'Escribe tu número completo, solo con dígitos; el código de país ya está elegido.'
} as const;

/** Mensaje de un campo (nombre del contrato) cuando el servidor lo rechazó sin más detalle: la regla del campo, en español. */
export function fieldMessage(field: string): string {
  switch (field) {
    case 'firstName': return MESSAGES.firstName;
    case 'lastName': return MESSAGES.lastName;
    case 'documentNumber': return MESSAGES.documentNumber;
    case 'nationality': return MESSAGES.nationality;
    case 'documentExpiryDate': return MESSAGES.date;
    case 'birthDate': return 'La fecha de nacimiento no es válida para este tipo de pasajero.';
    case 'gender': return MESSAGES.gender;
    case 'contact.email': return MESSAGES.email;
    case 'contact.phone': return MESSAGES.phone;
    default: return 'Revisa este dato.';
  }
}

/** Mensaje de edad, con la regla del tipo (sin la fecha escrita). */
export function ageMessage(type: PassengerType): string {
  const range = AGE_RANGES[type];
  const rule = type === 'ADULT' ? 'mayor de 17 años' : type === 'INFANT' ? 'menor de 2 años' : `de ${range.min} a ${range.max} años`;
  return `La fecha de nacimiento no corresponde a un pasajero ${PASSENGER_TYPE_NOUN[type]}: debe ser ${rule} a la fecha de la compra.`;
}

/** Campos de UN pasajero: formato de cada dato y edad según el tipo. Devuelve todos los incumplimientos (vacío = en orden). */
export function checkPassengerFields(passenger: PassengerFacts, index: number, at: Date = new Date()): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const add = (field: string, code: RuleCode, message: string): void => { issues.push({ index, field, code, message }); };
  if (!isValidName(passenger.firstName ?? '')) add('firstName', 'NAME_INVALID', MESSAGES.firstName);
  if (!isValidName(passenger.lastName ?? '')) add('lastName', 'NAME_INVALID', MESSAGES.lastName);
  if (!DOCUMENT_PATTERN.test(passenger.documentNumber ?? '')) add('documentNumber', 'DOCUMENT_INVALID', MESSAGES.documentNumber);
  const nationality = (passenger.nationality ?? '').trim();
  if (nationality.length < NATIONALITY_LENGTH.min || nationality.length > NATIONALITY_LENGTH.max) add('nationality', 'NATIONALITY_INVALID', MESSAGES.nationality);
  if (passenger.documentExpiryDate && !isCalendarDate(passenger.documentExpiryDate)) add('documentExpiryDate', 'DATE_INVALID', MESSAGES.date);
  if (!passenger.birthDate) add('birthDate', 'DATE_INVALID', MESSAGES.birthMissing);
  else if (!isCalendarDate(passenger.birthDate)) add('birthDate', 'DATE_INVALID', MESSAGES.date);
  else {
    const years = ageAt(passenger.birthDate, at);
    if (years < 0) add('birthDate', 'BIRTHDATE_FUTURE', MESSAGES.future);
    else if (!validAge(passenger.passengerType, years)) add('birthDate', 'AGE_MISMATCH', ageMessage(passenger.passengerType));
  }
  if (!(GENDERS as readonly string[]).includes(passenger.gender ?? '')) add('gender', 'GENDER_INVALID', MESSAGES.gender);
  if (!EMAIL_PATTERN.test(passenger.email ?? '')) add('contact.email', 'EMAIL_INVALID', MESSAGES.email);
  if (!PHONE_PATTERN.test(passenger.phone ?? '')) add('contact.phone', 'PHONE_INVALID', MESSAGES.phone);
  return issues;
}

/**
 * Conjunto de pasajeros contra el desglose del hold (la regla de Reservation, movida aquí tal cual): identificadores únicos, edad por tipo, cada infante con un
 * adulto distinto y sin asiento, conteos iguales y no más infantes que adultos. El orden de los incumplimientos es el de la comprobación original,
 * de modo que el primero es el que Reservation reportaba. La edad por tipo es la de `checkPassengerFields`.
 */
export function checkPassengerSet(passengers: readonly PassengerFacts[], expected: PassengerBreakdown, at: Date = new Date()): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const counts: PassengerBreakdown = { adults: 0, youths: 0, children: 0, infants: 0 };
  const ids = new Set<string>();
  const adults = new Set(passengers.filter((passenger) => passenger.passengerType === 'ADULT').map((passenger) => passenger.passengerId));
  const infantsByAdult = new Set<string>();
  const key: Record<PassengerType, keyof PassengerBreakdown> = { ADULT: 'adults', YOUTH: 'youths', CHILD: 'children', INFANT: 'infants' };
  passengers.forEach((passenger, index) => {
    const add = (field: string, code: RuleCode, message: string): void => { issues.push({ index, field, code, message }); };
    if (ids.has(passenger.passengerId)) add('passengerId', 'PASSENGER_ID_DUPLICATED', 'Cada pasajero debe tener un identificador distinto.');
    ids.add(passenger.passengerId);
    counts[key[passenger.passengerType]] += 1;
    const years = ageAt(passenger.birthDate, at);
    if (!validAge(passenger.passengerType, years)) add('birthDate', years < 0 ? 'BIRTHDATE_FUTURE' : 'AGE_MISMATCH', years < 0 ? MESSAGES.future : ageMessage(passenger.passengerType));
    if (passenger.passengerType === 'INFANT') {
      const adultId = passenger.associatedAdultId;
      if (!adultId || !adults.has(adultId)) add('associatedAdultId', 'INFANT_ADULT_REQUIRED', 'Indica el adulto con el que viaja el infante.');
      else if (infantsByAdult.has(adultId)) add('associatedAdultId', 'INFANT_ADULT_TAKEN', 'Cada adulto puede viajar con un solo infante.');
      if ((passenger.assignedSeats?.length ?? 0) > 0) add('assignedSeats', 'INFANT_SEAT_NOT_ALLOWED', 'Los infantes viajan en brazos, sin asiento propio.');
      if (adultId) infantsByAdult.add(adultId);
    }
  });
  if (counts.adults !== expected.adults || counts.youths !== expected.youths || counts.children !== expected.children || counts.infants !== expected.infants || counts.infants > counts.adults) issues.push({ index: -1, field: '', code: 'COUNT_MISMATCH', message: 'Los pasajeros no coinciden con los de la selección.' });
  return issues;
}
