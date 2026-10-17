import { decimalToMinor, DomainError, minorToDecimal } from '@flight-platform/shared';
import { BaggageOperation, BaggageOperations, BaggageResult } from '../../application/baggage-operations';
import { PrismaClient } from './prisma-client/client';

const map = (row: { id: string; bookingId: string; ownerId: string; idempotencyKey: string; requestHash: string; paymentReference: string; amountMinor: number; status: string; response: unknown }): BaggageOperation => ({ ...row, response: row.response as BaggageResult | undefined });
export class PrismaBaggageOperations implements BaggageOperations {
  constructor(private readonly prisma: PrismaClient) {}
  async find(ownerId: string, idempotencyKey: string): Promise<BaggageOperation | undefined> {
    const row = await this.prisma.baggagePurchase.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } } });
    return row ? map(row) : undefined;
  }
  async claim(operation: BaggageOperation): Promise<BaggageOperation> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.paymentUsage.create({ data: { paymentReference: operation.paymentReference, reservationId: operation.bookingId } });
        return tx.baggagePurchase.create({ data: { id: operation.id, bookingId: operation.bookingId, ownerId: operation.ownerId, idempotencyKey: operation.idempotencyKey, requestHash: operation.requestHash, paymentReference: operation.paymentReference, amountMinor: operation.amountMinor, status: 'PENDING' } });
      });
      return map(row);
    } catch (error) {
      if (typeof error !== 'object' || error === null || (error as { code?: string }).code !== 'P2002') throw error;
      const existing = await this.find(operation.ownerId, operation.idempotencyKey);
      if (existing) { if (existing.requestHash !== operation.requestHash) throw new DomainError('VALIDATION_FAILED'); return existing; }
      throw new DomainError('PAYMENT_REFERENCE_INVALID');
    }
  }
  async complete(operation: BaggageOperation, changedAt: Date, action: () => Promise<BaggageResult>): Promise<BaggageResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "baggage_purchases" WHERE "id" = ${operation.id}::uuid AND "owner_id" = ${operation.ownerId} FOR UPDATE`;
      const row = await tx.baggagePurchase.findFirst({ where: { id: operation.id, ownerId: operation.ownerId, bookingId: operation.bookingId } });
      if (!row) throw new DomainError('NOT_FOUND');
      if (row.status === 'COMPLETED') return row.response as unknown as BaggageResult;
      await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${operation.bookingId}::uuid AND "owner_id" = ${operation.ownerId} FOR UPDATE`;
      const reservation = await tx.reservation.findFirst({ where: { id: operation.bookingId, ownerId: operation.ownerId } });
      if (!reservation) throw new DomainError('NOT_FOUND');
      if (reservation.status !== 'CONFIRMED') throw new DomainError('BOOKING_NOT_CONFIRMED');
      const result = await action();
      const total = reservation.grandTotal as { currency: string; total: string };
      await tx.reservation.update({ where: { id: reservation.id }, data: { grandTotal: { ...total, total: minorToDecimal(decimalToMinor(total.total) + row.amountMinor) } } });
      await tx.reservationChange.create({ data: { reservationId: operation.bookingId, changedAt, description: 'BAGGAGE_ADDED' } });
      await tx.baggagePurchase.update({ where: { id: operation.id }, data: { status: 'COMPLETED', response: result as never } });
      return result;
    }, { timeout: 30000 });
  }
}
