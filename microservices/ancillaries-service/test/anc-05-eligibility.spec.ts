import { expect, it } from '@jest/globals';
import { assertSeatEligibility } from '../src/domain/seat-eligibility';

it('ANC-05 / U: un infante no puede ocupar asiento', () => {
  expect(() => assertSeatEligibility({ passengerType: 'INFANT', purchasedCabin: 'ECONOMY', seatCabin: 'ECONOMY', isEmergencyExit: false })).toThrow(expect.objectContaining({ code: 'INFANT_SEAT_NOT_ALLOWED' }));
});

it('ANC-05 / U: la cabina del asiento debe coincidir con la comprada', () => {
  expect(() => assertSeatEligibility({ passengerType: 'ADULT', purchasedCabin: 'ECONOMY', seatCabin: 'BUSINESS', isEmergencyExit: false })).toThrow(expect.objectContaining({ code: 'SEAT_CABIN_MISMATCH' }));
});

it('ANC-05 / U: un menor no puede ocupar una salida de emergencia', () => {
  expect(() => assertSeatEligibility({ passengerType: 'CHILD', purchasedCabin: 'ECONOMY', seatCabin: 'ECONOMY', isEmergencyExit: true })).toThrow(expect.objectContaining({ code: 'SEAT_CABIN_MISMATCH' }));
});
