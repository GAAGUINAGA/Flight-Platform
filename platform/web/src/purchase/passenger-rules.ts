import { checkPassengerFields, checkPassengerSet, countryByCode, DEFAULT_COUNTRY, DOCUMENT_MAX_LENGTH, DOCUMENT_MIN_LENGTH, isIsoDate, localDate, normalizeDocument, normalizeName, type PassengerFacts, type RuleIssue } from '@flight-platform/format';
import type { DocumentType, Gender, PassengerType } from '@flight-platform/graphql-schema/generated/types';
import { phoneE164, resolvePhone } from './phone';

/**
 * Datos y reglas de los pasajeros ANTES de llamar al servidor (diseño F12c-0 §3.6; ADR-F12-05; ADR-F12b1fix-05). Sin React ni DOM.
 * Las reglas de cada dato y la edad por tipo son las MISMAS de Reservation (la autoridad): salen de `packages/shared/src/passenger-rules.ts`.
 * Aquí solo están las del Gateway que la web ya adelantaba (pasaporte en vuelos internacionales y vigencia del documento), el documento repetido y el equipaje.
 * Esto solo evita viajes de ida y vuelta inútiles. Los mensajes nunca incluyen el valor escrito.
 */
export interface PassengerDraft {
  passengerId: string;
  passengerType: PassengerType;
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  documentNumber: string;
  /** Vencimiento del documento (AAAA-MM-DD). Obligatorio para el pasaporte. */
  documentExpiryDate: string;
  /** ISO 3166-1 alfa-2. */
  nationality: string;
  birthDate: string;
  gender: Gender | '';
  email: string;
  /** País del prefijo del teléfono (ISO-2) y número NACIONAL (solo dígitos). El E.164 que viaja lo compone `draftPhone`. */
  phoneCountry: string;
  phoneNational: string;
  /** Solo infantes: el adulto con el que viaja. */
  associatedAdultId: string;
  /** Maletas adicionales por tramo (itineraryId → 0..3). */
  extraBaggage: Record<string, number>;
}

export interface TripSegment { departureAt: string; departureIata: string; arrivalIata: string }
export interface RuleContext {
  segments: readonly TripSegment[];
  now?: Date;
  /** Aeropuertos nacionales (por omisión, los del Gateway). */
  domestic?: ReadonlySet<string>;
  /** Máximo de maletas adicionales por tramo (itineraryId) con la tarifa elegida; sin él solo rige el tope por entrada. */
  maxExtraBaggage?: Readonly<Record<string, number>>;
}

/** Tope por entrada de equipaje en una reserva (el RPC `createReservation` acepta 1..3 maletas por tramo). */
export const MAX_EXTRA_BAGGAGE = 3;
/**
 * Maletas facturadas TOTALES (incluidas en la tarifa + adicionales) por pasajero y tramo. La regla es del servidor: `BAGGAGE_MAX_ALLOWED`
 * de Ancillaries (por omisión 3; `microservices/ancillaries-service/src/infrastructure/grpc/server.ts`), y la aplica `PrismaBaggageStore.reserve`
 * (franquicia + ya compradas + pedidas > máximo ⇒ BAGGAGE_LIMIT_EXCEEDED). Antes de que exista la reserva ninguna operación pública entrega ese
 * máximo (`baggageOptions` pide una reserva y el contrato no cambia), así que se refleja aquí UNA vez; si el servidor lo cambia hay que cambiarlo
 * aquí. Con la reserva creada, la postventa NO usa este número: usa el `maxAllowed` que entrega el servidor.
 */
export const MAX_CHECKED_BAGS_PER_PASSENGER = 3;
/** Máximo de maletas ADICIONALES que admite una tarifa: el total permitido menos las maletas que ya incluye (nunca más de lo que acepta una entrada). */
export const maxExtraBaggage = (included: number | null | undefined): number => Math.max(0, Math.min(MAX_EXTRA_BAGGAGE, MAX_CHECKED_BAGS_PER_PASSENGER - (included ?? 0)));
/** Los mismos aeropuertos nacionales que el Gateway toma por omisión (`DEFAULT_DOMESTIC_AIRPORTS`). */
export const DOMESTIC_AIRPORTS: ReadonlySet<string> = new Set(['UIO', 'GYE', 'CUE', 'LTX', 'MEC', 'GPS', 'SCY', 'ESM', 'TUA', 'LOH', 'PVO', 'OCC', 'TPC', 'XMS', 'CPV', 'JIP', 'AIQ', 'ATF']);

export type PassengerErrors = Record<string, string>;
export const fieldKey = (index: number, field: string): string => `${index}.${field}`;

/** ¿Algún tramo toca un aeropuerto fuera del país? Entonces se exige pasaporte. */
export function isInternational(segments: readonly TripSegment[], domestic: ReadonlySet<string> = DOMESTIC_AIRPORTS): boolean {
  return segments.some((segment) => !domestic.has(segment.departureIata) || !domestic.has(segment.arrivalIata));
}

/** Fecha local del aeropuerto de salida del ÚLTIMO tramo: contra ella se mide la vigencia del documento (PLAN Q-010). */
export function lastTravelDate(segments: readonly TripSegment[]): string | null {
  const dates = segments.map((segment) => ({ at: Date.parse(segment.departureAt), date: localDate(segment.departureAt, segment.departureIata) })).filter((entry) => Number.isFinite(entry.at));
  dates.sort((a, b) => b.at - a.at);
  return dates[0]?.date ?? null;
}

export const emptyPassenger = (passengerId: string, passengerType: PassengerType): PassengerDraft => ({
  passengerId, passengerType, firstName: '', lastName: '', documentType: 'NATIONAL_ID', documentNumber: '', documentExpiryDate: '', nationality: DEFAULT_COUNTRY, birthDate: '', gender: '', email: '', phoneCountry: DEFAULT_COUNTRY, phoneNational: '', associatedAdultId: '', extraBaggage: {}
});

/** Campos de texto que se normalizan al salir del campo (y otra vez al enviar): lo que se valida y se envía es el valor normalizado. */
export type NormalizedField = 'firstName' | 'lastName' | 'documentNumber' | 'email';
export const NORMALIZED_FIELDS: readonly NormalizedField[] = ['firstName', 'lastName', 'documentNumber', 'email'];
const NORMALIZERS: Readonly<Record<NormalizedField, (value: string) => string>> = { firstName: normalizeName, lastName: normalizeName, documentNumber: normalizeDocument, email: (value) => value.trim() };
export const normalizeField = (field: NormalizedField, value: string): string => NORMALIZERS[field](value);
export const isNormalizedField = (field: string): field is NormalizedField => (NORMALIZED_FIELDS as readonly string[]).includes(field);

/** Pasajero con sus datos normalizados: lo que se valida y lo que viaja al servidor. */
export function normalizeDraft(draft: PassengerDraft): PassengerDraft {
  return { ...draft, firstName: normalizeName(draft.firstName), lastName: normalizeName(draft.lastName), documentNumber: normalizeDocument(draft.documentNumber), email: draft.email.trim() };
}

/** El teléfono E.164 del pasajero: lo compone `libphonenumber-js` a partir del país elegido y del número nacional, y solo si es válido para ese país; si no, vacío. */
export const draftPhone = (draft: Pick<PassengerDraft, 'phoneCountry' | 'phoneNational'>): string => phoneE164(draft.phoneCountry, draft.phoneNational);

const factsOf = (draft: PassengerDraft): PassengerFacts => ({
  passengerId: draft.passengerId, passengerType: draft.passengerType, associatedAdultId: draft.associatedAdultId || undefined, firstName: draft.firstName, lastName: draft.lastName,
  documentNumber: draft.documentNumber, nationality: draft.nationality, documentExpiryDate: draft.documentExpiryDate || undefined, birthDate: draft.birthDate, gender: draft.gender, email: draft.email, phone: draftPhone(draft)
});

/** Años hacia atrás de la fecha de nacimiento y hacia adelante del vencimiento del documento que admite el formulario (decisión del producto; no son reglas de Reservation). */
export const BIRTH_MAX_YEARS = 125;
export const EXPIRY_MAX_YEARS = 15;
const todayOf = (now: Date): string => now.toISOString().slice(0, 10);
/** La misma fecha `years` años después (o antes, si es negativo); el 29 de febrero cae en el 28 de los años no bisiestos. */
export function shiftYears(iso: string, years: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year + years, month - 1, day));
  if (date.getUTCMonth() !== month - 1) date.setUTCDate(0); // 29-feb → 28-feb
  return date.toISOString().slice(0, 10);
}
/** Fecha de nacimiento permitida: de hoy menos 125 años a hoy (hoy = fecha UTC, como mide la edad Reservation). */
export const birthDateRange = (now: Date = new Date()): { min: string; max: string } => ({ min: shiftYears(todayOf(now), -BIRTH_MAX_YEARS), max: todayOf(now) });
/** Vencimiento del documento permitido: desde hoy (o desde la fecha del último vuelo, si es posterior: regla del Gateway `DOCUMENT_EXPIRED`) hasta hoy más 15 años. */
export function expiryRange(now: Date = new Date(), lastTravel: string | null = null): { min: string; max: string } {
  const today = todayOf(now);
  return { min: lastTravel && lastTravel > today ? lastTravel : today, max: shiftYears(today, EXPIRY_MAX_YEARS) };
}
const display = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Largo de la cédula ecuatoriana. */
export const EC_ID_LENGTH = 10;
export interface DocumentRule { kind: 'ECUADOR_ID' | 'ALPHANUMERIC'; min: number; max: number; hint: string; message: string }
/**
 * Regla del número de documento según el TIPO y la NACIONALIDAD elegidos (decisión del producto, ADR-F12b1fix-05; es una restricción de la interfaz, no de Reservation):
 * cédula (`NATIONAL_ID`) con nacionalidad Ecuador → solo dígitos y exactamente 10; cualquier otro caso (pasaporte, o cédula de otra nacionalidad) → letras sin tildes y números,
 * de 5 a 20 (la regla de Reservation), sin bloquear letras.
 */
export function documentRule(type: DocumentType, nationality: string): DocumentRule {
  if (type === 'NATIONAL_ID' && nationality === 'EC') return { kind: 'ECUADOR_ID', min: EC_ID_LENGTH, max: EC_ID_LENGTH, hint: 'Cédula ecuatoriana: 10 números.', message: 'La cédula ecuatoriana lleva exactamente 10 números.' };
  return { kind: 'ALPHANUMERIC', min: DOCUMENT_MIN_LENGTH, max: DOCUMENT_MAX_LENGTH, hint: `Letras y números, de ${DOCUMENT_MIN_LENGTH} a ${DOCUMENT_MAX_LENGTH}.`, message: 'Escribe el número del documento: entre 5 y 20 letras o números, sin espacios ni guiones.' };
}

/** Nombre de campo del contrato (`contact.email`) → nombre del formulario (`email`). */
export const draftField = (field: string): string => (field === 'contact.email' ? 'email' : field === 'contact.phone' ? 'phone' : field);

/** Valida a todos los pasajeros. Devuelve un mapa `índice.campo → mensaje`; vacío = todo en orden. */
export function validatePassengers(passengers: readonly PassengerDraft[], context: RuleContext): PassengerErrors {
  const errors: PassengerErrors = {};
  const now = context.now ?? new Date();
  const international = isInternational(context.segments, context.domestic);
  const travel = lastTravelDate(context.segments);
  const normalized = passengers.map(normalizeDraft);
  const taken = new Map<string, number>();

  // Reglas compartidas con Reservation: formato de cada dato y edad por tipo (a la fecha de hoy).
  const shared: RuleIssue[] = normalized.flatMap((passenger, index) => checkPassengerFields(factsOf(passenger), index, now));
  for (const issue of shared) errors[fieldKey(issue.index, draftField(issue.field))] ??= issue.message;

  normalized.forEach((passenger, index) => {
    const set = (field: string, message: string): void => { errors[fieldKey(index, field)] ??= message; };
    if (international && passenger.documentType !== 'PASSPORT') set('documentType', 'Los vuelos internacionales requieren pasaporte.');
    const documentRuleNow = documentRule(passenger.documentType, passenger.nationality);
    // La cédula ecuatoriana manda sobre el mensaje general del documento (que habla de 5 a 20 letras o números).
    if (documentRuleNow.kind === 'ECUADOR_ID' && !/^\d{10}$/.test(passenger.documentNumber)) errors[fieldKey(index, 'documentNumber')] = documentRuleNow.message;
    if (!errors[fieldKey(index, 'documentNumber')]) {
      const duplicate = `${passenger.documentType}:${passenger.documentNumber}`;
      if (taken.has(duplicate)) set('documentNumber', 'Este documento ya se usó para otro pasajero.'); else taken.set(duplicate, index);
    }

    // Teléfono: si escribió un número que no es válido PARA SU PAÍS, el mensaje lo dice (el general solo pide completarlo).
    if (resolvePhone(passenger.phoneCountry, passenger.phoneNational).status === 'INVALID') errors[fieldKey(index, 'phone')] = `El número no es válido para ${countryByCode(passenger.phoneCountry)?.name ?? 'el país elegido'}. Revisa que esté completo y sin el código de país.`;

    const expiry = passenger.documentExpiryDate;
    if (passenger.documentType === 'PASSPORT' && !expiry) set('documentExpiryDate', 'Indica el vencimiento del pasaporte.');
    else if (expiry) {
      if (!isIsoDate(expiry)) set('documentExpiryDate', 'Escribe una fecha válida.');
      else if (travel && expiry < travel) set('documentExpiryDate', 'El documento vence antes del último vuelo del viaje.');
      else if (expiry < now.toISOString().slice(0, 10)) set('documentExpiryDate', 'El documento está vencido.');
      else if (expiry > expiryRange(now).max) set('documentExpiryDate', `El vencimiento no puede ser posterior al ${display(expiryRange(now).max)}.`);
    }
    if (isIsoDate(passenger.birthDate) && passenger.birthDate < birthDateRange(now).min) set('birthDate', `La fecha de nacimiento debe estar entre el ${display(birthDateRange(now).min)} y hoy.`);

    for (const [itineraryId, quantity] of Object.entries(passenger.extraBaggage)) {
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_EXTRA_BAGGAGE) set(`extraBaggage.${itineraryId}`, `Puedes llevar entre 0 y ${MAX_EXTRA_BAGGAGE} maletas adicionales.`);
      else if (quantity > 0 && passenger.passengerType === 'INFANT') set(`extraBaggage.${itineraryId}`, 'Los infantes no llevan equipaje facturado propio.');
      else if (context.maxExtraBaggage && quantity > (context.maxExtraBaggage[itineraryId] ?? MAX_EXTRA_BAGGAGE)) {
        const limit = context.maxExtraBaggage[itineraryId] ?? MAX_EXTRA_BAGGAGE;
        set(`extraBaggage.${itineraryId}`, limit === 0 ? 'Con la tarifa elegida no se pueden agregar maletas adicionales.' : `Con la tarifa elegida puedes agregar hasta ${limit} ${limit === 1 ? 'maleta adicional' : 'maletas adicionales'}.`);
      }
    }
  });

  // Todo infante con un adulto distinto y como máximo un infante por adulto: la regla de Reservation (conjunto de pasajeros). Los conteos son los del propio formulario.
  const expected = { adults: 0, youths: 0, children: 0, infants: 0 };
  for (const passenger of passengers) expected[({ ADULT: 'adults', YOUTH: 'youths', CHILD: 'children', INFANT: 'infants' } as const)[passenger.passengerType]] += 1;
  for (const issue of checkPassengerSet(normalized.map(factsOf), expected, now)) if (issue.index >= 0 && issue.field === 'associatedAdultId') errors[fieldKey(issue.index, 'associatedAdultId')] ??= issue.message;
  return errors;
}

/** Orden de los pasajeros en la compra: primero los que ocupan asiento (adultos, jóvenes, niños), después los infantes. Es el orden en que el hold reparte los asientos. */
export const TYPE_ORDER: readonly PassengerType[] = ['ADULT', 'YOUTH', 'CHILD', 'INFANT'];
export const needsSeat = (type: PassengerType): boolean => type !== 'INFANT';
export const typeLabel = (type: PassengerType): string => ({ ADULT: 'Adulto', YOUTH: 'Joven', CHILD: 'Niño', INFANT: 'Infante' })[type];
