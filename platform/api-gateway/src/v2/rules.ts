import { GatewayProblemError } from '../web-errors';

export interface Breakdown { adults: number; youths: number; children: number; infants: number }
export const DEFAULT_DOMESTIC_AIRPORTS = ['UIO', 'GYE', 'CUE', 'LTX', 'MEC', 'GPS', 'SCY', 'ESM', 'TUA', 'LOH', 'PVO', 'OCC', 'TPC', 'XMS', 'CPV', 'JIP', 'AIQ', 'ATF'];

const unprocessable = (code: string, detail: string): GatewayProblemError => new GatewayProblemError(422, code, detail);

/** Desglose con los valores por defecto del contrato (1 adulto, resto 0). */
export const normalizeBreakdown = (value: Partial<Breakdown> | undefined): Breakdown => ({ adults: value?.adults ?? 1, youths: value?.youths ?? 0, children: value?.children ?? 0, infants: value?.infants ?? 0 });

/** Máximo 9 pasajeros con asiento y un infante por adulto como máximo en total (`INFANT_WITHOUT_ADULT`). */
export function assertBreakdown(breakdown: Breakdown): void {
  if (breakdown.infants > breakdown.adults) throw unprocessable('INFANT_WITHOUT_ADULT', 'Cada infante debe viajar con un adulto');
  if (breakdown.adults + breakdown.youths + breakdown.children > 9) throw unprocessable('VALIDATION_FAILED', 'Máximo 9 pasajeros con asiento');
}

interface RulePassenger { passengerId: string; passengerType: string; associatedAdultId?: string; documentType: string; documentExpiryDate?: string }
interface RuleSegment { departure?: { iataCode?: string; at?: string }; arrival?: { iataCode?: string } }

/** Reglas de pasajeros que el contrato manda como 422 y el dominio no distingue (todo es VALIDATION_FAILED allí). */
export function assertPassengerRules(input: { passengers: RulePassenger[]; breakdown: Breakdown; itineraries: Array<{ segments?: RuleSegment[] }>; domestic: ReadonlySet<string> }): void {
  const { passengers, breakdown, itineraries, domestic } = input;
  const count = (type: string) => passengers.filter((passenger) => passenger.passengerType === type).length;
  if (count('ADULT') !== breakdown.adults || count('YOUTH') !== breakdown.youths || count('CHILD') !== breakdown.children || count('INFANT') !== breakdown.infants || passengers.length !== breakdown.adults + breakdown.youths + breakdown.children + breakdown.infants) throw unprocessable('PASSENGER_COUNT_MISMATCH', 'Los pasajeros no coinciden con el desglose del hold');
  const adults = new Set(passengers.filter((passenger) => passenger.passengerType === 'ADULT').map((passenger) => passenger.passengerId));
  for (const infant of passengers.filter((passenger) => passenger.passengerType === 'INFANT')) if (!infant.associatedAdultId || !adults.has(infant.associatedAdultId)) throw unprocessable('INFANT_WITHOUT_ADULT', 'Cada infante debe indicar un adulto acompañante de la reserva');
  const segments = itineraries.flatMap((itinerary) => itinerary.segments ?? []);
  const international = segments.some((segment) => [segment.departure?.iataCode, segment.arrival?.iataCode].some((code) => code !== undefined && !domestic.has(code)));
  if (international && passengers.some((passenger) => passenger.documentType !== 'PASSPORT')) throw unprocessable('PASSPORT_REQUIRED_INTERNATIONAL', 'Los vuelos internacionales exigen pasaporte');
  const lastDeparture = segments.map((segment) => segment.departure?.at).filter((at): at is string => typeof at === 'string').map((at) => Date.parse(at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (lastDeparture !== undefined) for (const passenger of passengers) if (passenger.documentExpiryDate && Date.parse(`${passenger.documentExpiryDate}T23:59:59Z`) < lastDeparture) throw unprocessable('DOCUMENT_EXPIRED', 'El documento vence antes del viaje');
}

export const domesticSet = (raw: string | undefined): ReadonlySet<string> => new Set(raw ? raw.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean) : DEFAULT_DOMESTIC_AIRPORTS);
