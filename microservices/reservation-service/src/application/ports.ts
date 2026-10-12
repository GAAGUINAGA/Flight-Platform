export interface HoldDetails {
  holdId: string;
  ownerId: string;
  status: string;
  expiresAt: string;
  lockedPrice: { currency: string; total: string };
  passengersBreakdown: { adults: number; youths: number; children: number; infants: number };
  itineraries: unknown[];
}

export interface InventoryPort {
  consumeHold(input: { holdId: string; ownerId: string; reservationId: string }): Promise<void>;
  releaseReservedInventory(input: { bookingId: string; ownerId: string }): Promise<void>;
}
export interface PricingPort { getHold(input: { holdId: string; ownerId: string }): Promise<HoldDetails>; }
export interface AncillariesPort {
  reserveSeats(input: unknown): Promise<void>;
  reserveBaggage(input: unknown): Promise<void>;
  confirmSeats(input: { bookingId: string; ownerId: string }): Promise<void>;
  releaseAll(input: { bookingId: string; ownerId: string }): Promise<void>;
  getAssignments(input: { bookingId: string; ownerId: string }): Promise<unknown[]>;
  getBaggageOptions(input: { bookingId: string; ownerId: string }): Promise<unknown[]>;
}
export interface TicketingPort {
  issueTickets(input: unknown): Promise<unknown[]>;
  voidTickets(input: { bookingId: string; ownerId: string }): Promise<void>;
  listTickets(input: { bookingId: string; ownerId: string }): Promise<unknown[]>;
}
export interface EventPublisher { publish(input: { ownerId: string; eventType: string; bookingId: string; pnr: string; status: string }): Promise<void>; }
export type PaymentResult = 'AUTHORIZED' | 'PENDING';
export interface PaymentVerifier { verify(input: { paymentReference: string; currency: string; total: string }): Promise<PaymentResult>; void(input: { paymentReference: string }): Promise<void>; }
