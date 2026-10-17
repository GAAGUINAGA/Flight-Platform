export interface CancellationQuoteRecord { quoteId: string; bookingId: string; ownerId: string; payload: unknown; expiresAt: Date; usedAt?: Date }
export interface CancellationQuotes {
  save(value: CancellationQuoteRecord): Promise<void>;
  find(ownerId: string, bookingId: string, quoteId: string): Promise<CancellationQuoteRecord | undefined>;
  consume(ownerId: string, bookingId: string, quoteId: string, at: Date): Promise<boolean>;
}
