import { expect, it } from '@jest/globals';
import { validatePassengers } from '../src/domain/passengers';
const adult = { passengerId: 'adult', passengerType: 'ADULT' as const, birthDate: '1990-01-01' };
const expected = { adults: 1, youths: 0, children: 0, infants: 0 };
const at = new Date('2026-01-01');
describe('RSV-04: passenger validation', () => {
  it('RSV-04 / U: rejects count and type different from hold breakdown', () => { expect(() => validatePassengers([adult], { ...expected, adults: 2 }, at)).toThrow('VALIDATION_FAILED'); });
  it('RSV-04 / U: rejects duplicated passengerId', () => { expect(() => validatePassengers([adult, adult], { ...expected, adults: 2 }, at)).toThrow('VALIDATION_FAILED'); });
  it('RSV-04 / U: rejects infant without an associated adult', () => { expect(() => validatePassengers([{ passengerId: 'infant', passengerType: 'INFANT', birthDate: '2025-01-01' }], { adults: 0, youths: 0, children: 0, infants: 1 }, at)).toThrow('VALIDATION_FAILED'); });
  it('RSV-04 / U: rejects two infants associated to one adult', () => { const infant = { passengerId: 'infant', passengerType: 'INFANT' as const, birthDate: '2025-01-01', associatedAdultId: 'adult' }; expect(() => validatePassengers([adult, infant, { ...infant, passengerId: 'infant-2' }], { adults: 1, youths: 0, children: 0, infants: 2 }, at)).toThrow('VALIDATION_FAILED'); });
  it('RSV-04 / U: rejects age inconsistent with passenger type', () => { expect(() => validatePassengers([{ ...adult, birthDate: '2025-01-01' }], expected, at)).toThrow('VALIDATION_FAILED'); });
  it('RSV-04 / U: rejects an infant with an assigned seat', () => { const infant = { passengerId: 'infant', passengerType: 'INFANT' as const, birthDate: '2025-01-01', associatedAdultId: 'adult', assignedSeats: [{}] }; expect(() => validatePassengers([adult, infant], { adults: 1, youths: 0, children: 0, infants: 1 }, at)).toThrow('INFANT_SEAT_NOT_ALLOWED'); });
});
