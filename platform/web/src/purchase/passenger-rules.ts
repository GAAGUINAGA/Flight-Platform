import { isIsoDate, localDate } from '@flight-platform/format';
import type { DocumentType, Gender, PassengerType } from '@flight-platform/graphql-schema/generated/types';

/**
 * Datos y reglas de los pasajeros ANTES de llamar al servidor (diseño F12c-0 §3.6; ADR-F12-05, PLAN Q-010). Sin React ni DOM.
 * El Gateway valida igual y es la autoridad: esto solo evita viajes de ida y vuelta inútiles. Los mensajes nunca incluyen el valor escrito.
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
  phone: string;
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
}

export const MAX_EXTRA_BAGGAGE = 3;
/** Los mismos aeropuertos nacionales que el Gateway toma por omisión (`DEFAULT_DOMESTIC_AIRPORTS`). */
export const DOMESTIC_AIRPORTS: ReadonlySet<string> = new Set(['UIO', 'GYE', 'CUE', 'LTX', 'MEC', 'GPS', 'SCY', 'ESM', 'TUA', 'LOH', 'PVO', 'OCC', 'TPC', 'XMS', 'CPV', 'JIP', 'AIQ', 'ATF']);

export type PassengerErrors = Record<string, string>;
export const fieldKey = (index: number, field: string): string => `${index}.${field}`;

/** ¿Algún tramo toca un aeropuerto fuera del país? Entonces se exige pasaporte. */
export function isInternational(segments: readonly TripSegment[], domestic: ReadonlySet<string> = DOMESTIC_AIRPORTS): boolean {
  return segments.some((segment) => !domestic.has(segment.departureIata) || !domestic.has(segment.arrivalIata));
}

/** Fecha local del aeropuerto de salida del ÚLTIMO tramo: contra ella se mide la vigencia del documento y la edad (PLAN Q-010). */
export function lastTravelDate(segments: readonly TripSegment[]): string | null {
  const dates = segments.map((segment) => ({ at: Date.parse(segment.departureAt), date: localDate(segment.departureAt, segment.departureIata) })).filter((entry) => Number.isFinite(entry.at));
  dates.sort((a, b) => b.at - a.at);
  return dates[0]?.date ?? null;
}

/** Años cumplidos a una fecha (ambas AAAA-MM-DD). */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number); const [y, m, d] = onDate.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Rango de edad (años cumplidos al último tramo) de cada tipo: INFANT < 2, CHILD 2–11, YOUTH 12–15, ADULT ≥ 16. */
export const AGE_RANGES: Readonly<Record<PassengerType, { min: number; max: number }>> = {
  INFANT: { min: 0, max: 1 }, CHILD: { min: 2, max: 11 }, YOUTH: { min: 12, max: 15 }, ADULT: { min: 16, max: 150 }
};

const NAME = /^[\p{L}][\p{L}\p{M}' .-]{0,59}$/u;
const DOCUMENT = /^[A-Za-z0-9-]{5,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const COUNTRY = /^[A-Z]{2}$/;

export const emptyPassenger = (passengerId: string, passengerType: PassengerType): PassengerDraft => ({
  passengerId, passengerType, firstName: '', lastName: '', documentType: 'NATIONAL_ID', documentNumber: '', documentExpiryDate: '', nationality: 'EC', birthDate: '', gender: '', email: '', phone: '', associatedAdultId: '', extraBaggage: {}
});

/** Valida a todos los pasajeros. Devuelve un mapa `índice.campo → mensaje`; vacío = todo en orden. */
export function validatePassengers(passengers: readonly PassengerDraft[], context: RuleContext): PassengerErrors {
  const errors: PassengerErrors = {};
  const now = context.now ?? new Date();
  const international = isInternational(context.segments, context.domestic);
  const travel = lastTravelDate(context.segments);
  const firstTravel = context.segments.length > 0 ? localDate(context.segments.reduce((first, segment) => (Date.parse(segment.departureAt) < Date.parse(first.departureAt) ? segment : first)).departureAt, context.segments[0].departureIata) : null;
  const adults = new Set(passengers.filter((passenger) => passenger.passengerType === 'ADULT').map((passenger) => passenger.passengerId));
  const taken = new Map<string, number>();

  passengers.forEach((passenger, index) => {
    const set = (field: string, message: string): void => { errors[fieldKey(index, field)] ??= message; };
    if (!NAME.test(passenger.firstName.trim())) set('firstName', 'Escribe los nombres tal como figuran en el documento.');
    if (!NAME.test(passenger.lastName.trim())) set('lastName', 'Escribe los apellidos tal como figuran en el documento.');

    if (international && passenger.documentType !== 'PASSPORT') set('documentType', 'Los vuelos internacionales requieren pasaporte.');
    const number = passenger.documentNumber.trim();
    if (!DOCUMENT.test(number)) set('documentNumber', 'Escribe el número del documento (entre 5 y 20 letras o números).');
    else {
      const duplicate = `${passenger.documentType}:${number.toUpperCase()}`;
      if (taken.has(duplicate)) set('documentNumber', 'Este documento ya se usó para otro pasajero.'); else taken.set(duplicate, index);
    }

    const expiry = passenger.documentExpiryDate;
    if (passenger.documentType === 'PASSPORT' && !expiry) set('documentExpiryDate', 'Indica el vencimiento del pasaporte.');
    else if (expiry) {
      if (!isIsoDate(expiry)) set('documentExpiryDate', 'Escribe una fecha válida.');
      else if (travel && expiry < travel) set('documentExpiryDate', 'El documento vence antes del último vuelo del viaje.');
      else if (expiry < now.toISOString().slice(0, 10)) set('documentExpiryDate', 'El documento está vencido.');
    }

    if (!COUNTRY.test(passenger.nationality)) set('nationality', 'Elige la nacionalidad.');

    if (!isIsoDate(passenger.birthDate)) set('birthDate', 'Escribe la fecha de nacimiento.');
    else if (passenger.birthDate > now.toISOString().slice(0, 10)) set('birthDate', 'La fecha de nacimiento no puede ser futura.');
    else if (travel) {
      const age = ageOn(passenger.birthDate, travel); const range = AGE_RANGES[passenger.passengerType];
      if (age < range.min || age > range.max) set('birthDate', infantTurnsTwoMessage(passenger.passengerType, firstTravel, passenger.birthDate, travel) ?? `La fecha no corresponde a un pasajero ${TYPE_LABEL[passenger.passengerType]} en la fecha del viaje.`);
    }

    if (passenger.gender === '') set('gender', 'Elige el género.');
    if (!EMAIL.test(passenger.email.trim())) set('email', 'Escribe un correo electrónico válido.');
    if (!PHONE.test(passenger.phone.trim())) set('phone', 'Escribe un teléfono válido, con código de país.');

    if (passenger.passengerType === 'INFANT') {
      if (!passenger.associatedAdultId || !adults.has(passenger.associatedAdultId)) set('associatedAdultId', 'Indica el adulto con el que viaja el infante.');
    }
    for (const [itineraryId, quantity] of Object.entries(passenger.extraBaggage)) {
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_EXTRA_BAGGAGE) set(`extraBaggage.${itineraryId}`, `Puedes llevar entre 0 y ${MAX_EXTRA_BAGGAGE} maletas adicionales.`);
      else if (quantity > 0 && passenger.passengerType === 'INFANT') set(`extraBaggage.${itineraryId}`, 'Los infantes no llevan equipaje facturado propio.');
    }
  });

  // Todo infante con un adulto distinto y como máximo un infante por adulto.
  const perAdult = new Map<string, number>();
  passengers.forEach((passenger, index) => {
    if (passenger.passengerType !== 'INFANT' || !passenger.associatedAdultId) return;
    perAdult.set(passenger.associatedAdultId, (perAdult.get(passenger.associatedAdultId) ?? 0) + 1);
    if ((perAdult.get(passenger.associatedAdultId) ?? 0) > 1) errors[fieldKey(index, 'associatedAdultId')] ??= 'Cada adulto puede viajar con un solo infante.';
  });
  return errors;
}

const TYPE_LABEL: Readonly<Record<PassengerType, string>> = { ADULT: 'adulto', YOUTH: 'joven', CHILD: 'niño', INFANT: 'infante' };

/** Un infante que cumple 2 años antes del último tramo debe comprarse como niño (EC-28): explicación específica. */
function infantTurnsTwoMessage(type: PassengerType, firstTravel: string | null, birthDate: string, lastTravel: string): string | null {
  if (type !== 'INFANT' || !firstTravel) return null;
  return ageOn(birthDate, firstTravel) <= 1 && ageOn(birthDate, lastTravel) >= 2 ? 'El infante cumple 2 años antes del último vuelo: debe viajar como niño con su propio asiento.' : null;
}

/** Orden de los pasajeros en la compra: primero los que ocupan asiento (adultos, jóvenes, niños), después los infantes. Es el orden en que el hold reparte los asientos. */
export const TYPE_ORDER: readonly PassengerType[] = ['ADULT', 'YOUTH', 'CHILD', 'INFANT'];
export const needsSeat = (type: PassengerType): boolean => type !== 'INFANT';
export const typeLabel = (type: PassengerType): string => ({ ADULT: 'Adulto', YOUTH: 'Joven', CHILD: 'Niño', INFANT: 'Infante' })[type];
