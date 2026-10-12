import { expect, it } from '@jest/globals';
import { FlightReservation } from '../src/domain/reservation';

const reaches = (from: Array<'PENDING_PAYMENT' | 'TICKET_ISSUING' | 'CONFIRMED' | 'CHANGE_PENDING' | 'CANCELLATION_PENDING'>) => { const reservation = new FlightReservation(); for (const status of from) reservation.transition(status); return reservation; };
describe('RSV-03: state machine', () => {
  it('RSV-03 / U: PENDING -> PENDING_PAYMENT is valid', () => { expect(reaches(['PENDING_PAYMENT']).status).toBe('PENDING_PAYMENT'); });
  it('RSV-03 / U: PENDING -> TICKET_ISSUING is valid', () => { expect(reaches(['TICKET_ISSUING']).status).toBe('TICKET_ISSUING'); });
  it('RSV-03 / U: PENDING_PAYMENT -> TICKET_ISSUING is valid', () => { expect(reaches(['PENDING_PAYMENT', 'TICKET_ISSUING']).status).toBe('TICKET_ISSUING'); });
  it('RSV-03 / U: TICKET_ISSUING -> CONFIRMED records a change', () => { const reservation = reaches(['TICKET_ISSUING']); reservation.transition('CONFIRMED'); expect(reservation.changes).toHaveLength(2); });
  it('RSV-03 / U: CONFIRMED -> CHANGE_PENDING -> CONFIRMED is valid', () => { expect(reaches(['TICKET_ISSUING', 'CONFIRMED', 'CHANGE_PENDING', 'CONFIRMED']).status).toBe('CONFIRMED'); });
  it('RSV-03 / U: CONFIRMED -> CANCELLATION_PENDING -> CANCELLED is valid', () => { const reservation = reaches(['TICKET_ISSUING', 'CONFIRMED', 'CANCELLATION_PENDING']); reservation.transition('CANCELLED'); expect(reservation.status).toBe('CANCELLED'); });
  it('RSV-03 / U: invalid transition is rejected', () => { expect(() => new FlightReservation().transition('CONFIRMED')).toThrow('BOOKING_NOT_CONFIRMED'); });
  it('RSV-03 / U: CANCELLED is terminal', () => { const reservation = reaches(['TICKET_ISSUING', 'CONFIRMED', 'CANCELLATION_PENDING']); reservation.transition('CANCELLED'); expect(() => reservation.transition('CONFIRMED')).toThrow('BOOKING_NOT_CONFIRMED'); });
  it('RSV-03 / U: FAILED is terminal', () => { const reservation = new FlightReservation(); reservation.transition('FAILED'); expect(() => reservation.transition('PENDING')).toThrow('BOOKING_NOT_CONFIRMED'); });
});
