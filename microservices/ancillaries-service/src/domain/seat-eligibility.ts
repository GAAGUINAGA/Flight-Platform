import { DomainError } from '@flight-platform/shared';

export type PassengerType = 'ADULT' | 'YOUTH' | 'CHILD' | 'INFANT';

export function assertSeatEligibility(input: { passengerType: PassengerType; purchasedCabin: string; seatCabin: string; isEmergencyExit: boolean }): void {
  if (input.passengerType === 'INFANT') throw new DomainError('INFANT_SEAT_NOT_ALLOWED');
  if (input.purchasedCabin !== input.seatCabin) throw new DomainError('SEAT_CABIN_MISMATCH');
  if (input.isEmergencyExit && (input.passengerType === 'CHILD' || input.passengerType === 'YOUTH')) throw new DomainError('SEAT_CABIN_MISMATCH');
}
