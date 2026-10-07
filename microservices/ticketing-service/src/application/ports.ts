import { Ticket } from '../domain/ticket';
export interface TicketStore {
  issue(bookingId: string, requestId: string, ownerId: string, passengers: Array<{ passengerId: string }>, segmentIds: string[], prefix: string, failMode: string, now: Date): Promise<Ticket[]>;
  forBooking(bookingId: string, ownerId: string): Promise<Ticket[] | null>;
  get(bookingId: string, ticketId: string, ownerId: string): Promise<Ticket | null>;
  updateAll(bookingId: string, ownerId: string, action: 'void' | 'refund' | 'reissue', segmentIds?: string[], prefix?: string, now?: Date): Promise<Ticket[]>;
}
