import { DomainError } from '@flight-platform/shared';
export type PassengerType = 'ADULT' | 'YOUTH' | 'CHILD' | 'INFANT';
export interface Passenger { passengerId: string; passengerType: PassengerType; associatedAdultId?: string; birthDate: string; assignedSeats?: unknown[]; }
export interface PassengerBreakdown { adults: number; youths: number; children: number; infants: number; }
const age = (birthDate: string, at: Date): number => { const birthday = new Date(`${birthDate}T00:00:00.000Z`); let years = at.getUTCFullYear() - birthday.getUTCFullYear(); if (at.getUTCMonth() < birthday.getUTCMonth() || at.getUTCMonth() === birthday.getUTCMonth() && at.getUTCDate() < birthday.getUTCDate()) years -= 1; return years; };
const validAge = (type: PassengerType, years: number): boolean => ({ INFANT: years >= 0 && years < 2, CHILD: years >= 2 && years < 12, YOUTH: years >= 12 && years < 18, ADULT: years >= 18 })[type];
export function validatePassengers(passengers: Passenger[], expected: PassengerBreakdown, at: Date = new Date()): void {
  const counts: PassengerBreakdown = { adults: 0, youths: 0, children: 0, infants: 0 }; const ids = new Set<string>(); const adults = new Set(passengers.filter((passenger) => passenger.passengerType === 'ADULT').map((passenger) => passenger.passengerId)); const infantsByAdult = new Set<string>();
  for (const passenger of passengers) {
    if (ids.has(passenger.passengerId)) throw new DomainError('VALIDATION_FAILED'); ids.add(passenger.passengerId);
    const key: Record<PassengerType, keyof PassengerBreakdown> = { ADULT: 'adults', YOUTH: 'youths', CHILD: 'children', INFANT: 'infants' }; counts[key[passenger.passengerType]] += 1;
    if (!validAge(passenger.passengerType, age(passenger.birthDate, at))) throw new DomainError('VALIDATION_FAILED');
    if (passenger.passengerType === 'INFANT') { if (!passenger.associatedAdultId || !adults.has(passenger.associatedAdultId) || infantsByAdult.has(passenger.associatedAdultId)) throw new DomainError('VALIDATION_FAILED'); if ((passenger.assignedSeats?.length ?? 0) > 0) throw new DomainError('INFANT_SEAT_NOT_ALLOWED'); infantsByAdult.add(passenger.associatedAdultId); }
  }
  if (counts.adults !== expected.adults || counts.youths !== expected.youths || counts.children !== expected.children || counts.infants !== expected.infants || counts.infants > counts.adults) throw new DomainError('VALIDATION_FAILED');
}
