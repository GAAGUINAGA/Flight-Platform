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
  createHold?(input: { ownerId: string; segments: Array<{ flightInstanceId: string; cabinClass: string; seats: number }>; expiresAt: string; idempotencyKey: string }): Promise<{ holdId: string }>;
  releaseReservedInventory(input: { bookingId: string; ownerId: string }): Promise<void>;
}
export interface PricingPort {
  getHold(input: { holdId: string; ownerId: string }): Promise<HoldDetails>;
  quoteChange?(input: unknown): Promise<{ offers: unknown[] }>;
  getChangeOffer?(input: { changeOfferId: string; ownerId: string }): Promise<unknown>;
  markChangeOfferUsed?(input: { changeOfferId: string; ownerId: string }): Promise<void>;
  quoteCancellation?(input: unknown): Promise<unknown>;
  releaseHold?(input: { holdId: string; ownerId: string }): Promise<void>;
}
export interface AncillariesPort {
  registerBaggageAllowance(input: { bookingId: string; ownerId: string; allowances: Array<{ passengerId: string; itineraryId: string; checkedBaggageIncluded: number }> }): Promise<void>;
  reserveSeats(input: unknown): Promise<void>;
  reserveBaggage(input: unknown): Promise<void>;
  confirmSeats(input: { bookingId: string; ownerId: string }): Promise<void>;
  releaseAll(input: { bookingId: string; ownerId: string }): Promise<void>;
  getAssignments(input: { bookingId: string; ownerId: string }): Promise<unknown[]>;
  getBaggageOptions(input: { bookingId: string; ownerId: string }): Promise<unknown[]>;
  purchaseBaggage(input: { bookingId: string; ownerId: string; passengerId: string; itineraryId: string; quantity: number; operationId: string }): Promise<{ passengerId: string; itineraryId: string; totalBaggage: number }>;
}
export interface TicketingPort {
  issueTickets(input: unknown): Promise<unknown[]>;
  voidTickets(input: { bookingId: string; ownerId: string }): Promise<void>;
  listTickets(input: { bookingId: string; ownerId: string }): Promise<unknown[]>;
  reissueTickets?(input: { bookingId: string; ownerId: string; newItineraries: unknown[] }): Promise<unknown[]>;
  refundTickets?(input: { bookingId: string; ownerId: string }): Promise<void>;
}
export interface EventPublisher { publish(input: { ownerId: string; eventType: string; bookingId: string; pnr: string; status: string; eventId?: string; refundAmount?: string; extra?: Record<string, unknown> }): Promise<void>; }
export type PaymentResult = 'AUTHORIZED' | 'PENDING';
export interface PaymentVerifier { verify(input: { paymentReference: string; currency: string; total: string; channel?: string }): Promise<PaymentResult>; void(input: { paymentReference: string }): Promise<void>; refund?(input: { paymentReference: string; amount: string; currency: string }): Promise<void>; }
