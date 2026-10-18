import { DomainError } from '@flight-platform/shared';
import { BaggageAllowanceItem, BaggageItem, BaggageStore } from '../../application/baggage';
import { PrismaClient } from './prisma-client/client';
import process from 'node:process';

const transactionOptions = () => {
  const read = (name: string, fallback: number): number => {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
    return value;
  };
  return { maxWait: read('ANCILLARIES_TX_MAX_WAIT_MS', 4000), timeout: read('ANCILLARIES_TX_TIMEOUT_MS', 4000) };
};

const map = (item: { bookingId: string; ownerId: string; passengerId: string | null; itineraryId: string; quantity: number; status: string }): BaggageItem => ({ ...item, status: item.status as BaggageItem['status'] });
export class PrismaBaggageStore implements BaggageStore {
  constructor(private readonly prisma: PrismaClient) {}
  async reserve(input: BaggageItem[], maxAllowed: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const sorted = [...input].sort((left, right) => `${left.bookingId}:${left.passengerId}:${left.itineraryId}`.localeCompare(`${right.bookingId}:${right.passengerId}:${right.itineraryId}`));
      for (const item of sorted) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${item.bookingId}:${item.passengerId}:${item.itineraryId}`}))`;
        if (item.passengerId) {
          const included = await tx.baggageAllowance.findFirst({ where: { bookingId: item.bookingId, ownerId: item.ownerId, passengerId: item.passengerId, itineraryId: item.itineraryId } });
          const purchased = await tx.baggageItem.aggregate({ where: { bookingId: item.bookingId, ownerId: item.ownerId, passengerId: item.passengerId, itineraryId: item.itineraryId, status: { not: 'RELEASED' } }, _sum: { quantity: true } });
          if ((included?.checkedBaggageIncluded ?? 0) + (purchased._sum.quantity ?? 0) + item.quantity > maxAllowed) throw new DomainError('BAGGAGE_LIMIT_EXCEEDED');
        }
        await tx.baggageItem.create({ data: item });
      }
    }, transactionOptions());
  }
  async registerAllowances(input: BaggageAllowanceItem[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.baggageAllowance.createMany({ data: input, skipDuplicates: true });
      const rows = await tx.baggageAllowance.findMany({ where: { OR: input.map(({ bookingId, passengerId, itineraryId }) => ({ bookingId, passengerId, itineraryId })) } });
      const savedByKey = new Map(rows.map((row) => [`${row.bookingId}:${row.passengerId}:${row.itineraryId}`, row]));
      for (const item of input) {
        const saved = savedByKey.get(`${item.bookingId}:${item.passengerId}:${item.itineraryId}`);
        if (!saved || saved.ownerId !== item.ownerId || saved.checkedBaggageIncluded !== item.checkedBaggageIncluded) throw new DomainError('VALIDATION_FAILED');
      }
    }, transactionOptions());
  }
  async listAllowances(bookingId: string, ownerId: string): Promise<BaggageAllowanceItem[]> { return this.prisma.baggageAllowance.findMany({ where: { bookingId, ownerId } }); }
  async purchase(input: BaggageItem, maxAllowed: number, operationId?: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.bookingId}:${input.passengerId}:${input.itineraryId}`}))`;
      if (operationId) {
        const existing = await tx.baggageItem.findUnique({ where: { operationId } });
        if (existing) {
          if (existing.bookingId !== input.bookingId || existing.ownerId !== input.ownerId || existing.passengerId !== input.passengerId || existing.itineraryId !== input.itineraryId || existing.quantity !== input.quantity || existing.resultTotal === null) throw new DomainError('VALIDATION_FAILED');
          return existing.resultTotal;
        }
      }
      const current = await tx.baggageItem.aggregate({ where: { bookingId: input.bookingId, ownerId: input.ownerId, passengerId: input.passengerId, itineraryId: input.itineraryId, status: { not: 'RELEASED' } }, _sum: { quantity: true } });
      const allowance = input.passengerId ? await tx.baggageAllowance.findFirst({ where: { bookingId: input.bookingId, ownerId: input.ownerId, passengerId: input.passengerId, itineraryId: input.itineraryId } }) : null;
      const total = (allowance?.checkedBaggageIncluded ?? 0) + (current._sum.quantity ?? 0) + input.quantity;
      if (total > maxAllowed) throw new DomainError('BAGGAGE_LIMIT_EXCEEDED');
      await tx.baggageItem.create({ data: { ...input, operationId, resultTotal: total } });
      return total;
    }, transactionOptions());
  }
  async list(bookingId: string, ownerId: string): Promise<BaggageItem[]> { return (await this.prisma.baggageItem.findMany({ where: { bookingId, ownerId } })).map(map); }
  async release(bookingId: string, ownerId: string): Promise<void> { await this.prisma.baggageItem.updateMany({ where: { bookingId, ownerId, status: { not: 'RELEASED' } }, data: { status: 'RELEASED' } }); }
}
