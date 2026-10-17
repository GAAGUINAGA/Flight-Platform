import { PrismaClient } from './prisma-client/client';
import { CancellationQuoteRecord, CancellationQuotes } from '../../application/cancellation-quotes';

export class PrismaCancellationQuotes implements CancellationQuotes {
  constructor(private readonly prisma: PrismaClient) {}
  async save(value: CancellationQuoteRecord): Promise<void> {
    await this.prisma.cancellationQuoteRecord.create({ data: { quoteId: value.quoteId, bookingId: value.bookingId, ownerId: value.ownerId, payload: value.payload as never, expiresAt: value.expiresAt } });
  }
  async find(ownerId: string, bookingId: string, quoteId: string): Promise<CancellationQuoteRecord | undefined> {
    const row = await this.prisma.cancellationQuoteRecord.findFirst({ where: { ownerId, bookingId, quoteId } });
    return row ? { quoteId: row.quoteId, bookingId: row.bookingId, ownerId: row.ownerId, payload: row.payload, expiresAt: row.expiresAt, ...(row.usedAt ? { usedAt: row.usedAt } : {}) } : undefined;
  }
  async consume(ownerId: string, bookingId: string, quoteId: string, at: Date): Promise<boolean> {
    const result = await this.prisma.cancellationQuoteRecord.updateMany({ where: { ownerId, bookingId, quoteId, usedAt: null, expiresAt: { gt: at } }, data: { usedAt: at } });
    return result.count === 1;
  }
}
