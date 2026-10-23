import { expect, it } from '@jest/globals';
import { reservationDependencyDeadline } from '../src/infrastructure/clients/deadline-service';

it('configura plazos de dependencias de Reservation y rechaza valores inválidos', () => {
  expect(reservationDependencyDeadline('pricing', {})).toBe(10000);
  expect(reservationDependencyDeadline('pricing', { RESERVATION_DEPENDENCY_DEADLINE_MS: '15000', RESERVATION_PRICING_DEADLINE_MS: '12000' })).toBe(12000);
  expect(reservationDependencyDeadline('inventory', { RESERVATION_DEPENDENCY_DEADLINE_MS: '15000' })).toBe(15000);
  expect(() => reservationDependencyDeadline('ticketing', { RESERVATION_TICKETING_DEADLINE_MS: '0' })).toThrow();
});
