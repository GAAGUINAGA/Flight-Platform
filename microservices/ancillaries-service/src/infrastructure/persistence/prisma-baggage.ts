import { DomainError } from '@flight-platform/shared';
import { BaggageItem, BaggageStore } from '../../application/baggage';
import { PrismaClient } from './prisma-client/client';

const map = (item: { bookingId: string; ownerId: string; passengerId: string | null; itineraryId: string; quantity: number; status: string }): BaggageItem => ({ ...item, status: item.status as BaggageItem['status'] });
export class PrismaBaggageStore implements BaggageStore {
  constructor(private readonly prisma: PrismaClient) {}
  async reserve(input: BaggageItem[]): Promise<void> { await this.prisma.baggageItem.createMany({ data: input }); }
  async purchase(input: BaggageItem, maxAllowed: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.bookingId}:${input.passengerId}:${input.itineraryId}`}))`;
      const current = await tx.baggageItem.aggregate({ where: { bookingId: input.bookingId, ownerId: input.ownerId, passengerId: input.passengerId, itineraryId: input.itineraryId, status: { not: 'RELEASED' } }, _sum: { quantity: true } });
      const total = (current._sum.quantity ?? 0) + input.quantity;
      if (total > maxAllowed) throw new DomainError('BAGGAGE_LIMIT_EXCEEDED');
      await tx.baggageItem.create({ data: input });
      return total;
    });
  }
  async list(bookingId: string, ownerId: string): Promise<BaggageItem[]> { return (await this.prisma.baggageItem.findMany({ where: { bookingId, ownerId } })).map(map); }
  async release(bookingId: string, ownerId: string): Promise<void> { const updated = await this.prisma.baggageItem.updateMany({ where: { bookingId, ownerId, status: { not: 'RELEASED' } }, data: { status: 'RELEASED' } }); if (updated.count === 0 && !(await this.prisma.baggageItem.findFirst({ where: { bookingId, ownerId } }))) throw new DomainError('NOT_FOUND'); }
}
