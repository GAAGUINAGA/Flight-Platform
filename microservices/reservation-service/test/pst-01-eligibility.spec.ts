import { expect, it } from '@jest/globals';
import { assertPostSaleEligible } from '../src/domain/post-sale-eligibility';

const now = new Date('2026-10-17T00:00:00.000Z');
const itinerary = (at: string) => [{ segments: [{ departure: { at } }] }];
it('PST-01 / U: permite una reserva confirmada con todos sus segmentos futuros', () => {
  expect(() => assertPostSaleEligible('CONFIRMED', itinerary('2026-10-18T00:00:00.000Z'), now)).not.toThrow();
});
it('PST-01 / U: rechaza una reserva que no está confirmada', () => {
  expect(() => assertPostSaleEligible('CHANGE_PENDING', itinerary('2026-10-18T00:00:00.000Z'), now)).toThrow('BOOKING_NOT_CONFIRMED');
});
it('PST-01 / U: rechaza una salida en el instante actual', () => {
  expect(() => assertPostSaleEligible('CONFIRMED', itinerary(now.toISOString()), now)).toThrow('FLIGHT_ALREADY_DEPARTED');
});
it('PST-01 / U: rechaza snapshots incompletos en lugar de tratarlos como elegibles', () => {
  expect(() => assertPostSaleEligible('CONFIRMED', itinerary('invalid'), now)).toThrow('VALIDATION_FAILED');
});
