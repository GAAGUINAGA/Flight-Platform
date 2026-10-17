export interface BaggageResult { passengerId: string; itineraryId: string; totalBaggage: number }
export interface BaggageOperation { id: string; bookingId: string; ownerId: string; idempotencyKey: string; requestHash: string; paymentReference: string; amountMinor: number; status: string; response?: BaggageResult }
export interface BaggageOperations {
  find(ownerId: string, idempotencyKey: string): Promise<BaggageOperation | undefined>;
  claim(operation: BaggageOperation): Promise<BaggageOperation>;
  complete(operation: BaggageOperation, changedAt: Date, action: () => Promise<BaggageResult>): Promise<BaggageResult>;
}
