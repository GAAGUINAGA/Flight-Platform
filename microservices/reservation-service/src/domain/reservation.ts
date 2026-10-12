import { DomainError } from '@flight-platform/shared';

export const reservationStatuses = ['PENDING', 'PENDING_PAYMENT', 'TICKET_ISSUING', 'CONFIRMED', 'CHANGE_PENDING', 'CANCELLATION_PENDING', 'CANCELLED', 'FAILED'] as const;
export type ReservationStatus = typeof reservationStatuses[number];
export interface ReservationChange { changedAt: string; description: string; }
const allowed: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ['PENDING_PAYMENT', 'TICKET_ISSUING', 'FAILED'], PENDING_PAYMENT: ['TICKET_ISSUING', 'FAILED'],
  TICKET_ISSUING: ['CONFIRMED', 'FAILED'], CONFIRMED: ['CHANGE_PENDING', 'CANCELLATION_PENDING'],
  CHANGE_PENDING: ['CONFIRMED'], CANCELLATION_PENDING: ['CANCELLED'], CANCELLED: [], FAILED: []
};
export class FlightReservation {
  readonly changes: ReservationChange[] = [];
  constructor(public status: ReservationStatus = 'PENDING') {}
  transition(next: ReservationStatus, now: Date = new Date()): void {
    if (!allowed[this.status].includes(next)) throw new DomainError(next === 'CANCELLED' && this.status === 'CANCELLED' ? 'ALREADY_CANCELLED' : 'BOOKING_NOT_CONFIRMED');
    this.status = next;
    this.changes.push({ changedAt: now.toISOString(), description: `${next}` });
  }
}
