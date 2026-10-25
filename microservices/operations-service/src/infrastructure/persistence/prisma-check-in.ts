import { DomainError } from '@flight-platform/shared';
import process from 'node:process';
import { CheckInPass, CheckInResult, CheckInStore } from '../../application/check-in-ports';
import { Prisma, PrismaClient } from './prisma-client/client';

export class PrismaCheckInStore implements CheckInStore {
  constructor(private readonly prisma: PrismaClient) {}

  async find(ownerId: string, bookingId: string): Promise<{ status: string; result: CheckInResult | null; eventPublished: boolean } | null> {
    const row = await this.prisma.checkIn.findFirst({ where: { ownerId, bookingId } });
    return row ? { status: row.status, result: row.result as unknown as CheckInResult | null, eventPublished: row.eventPublished } : null;
  }

  async begin(ownerId: string, bookingId: string): Promise<boolean> {
    try { await this.prisma.checkIn.create({ data: { ownerId, bookingId, status: 'IN_PROGRESS' } }); return true; }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false; throw error; }
  }
  async resume(ownerId: string, bookingId: string): Promise<boolean> {
    const updated = await this.prisma.checkIn.updateMany({ where: { ownerId, bookingId, status: { in: ['COMPLETED', 'FAILED'] } }, data: { status: 'IN_PROGRESS' } });
    return updated.count === 1;
  }

  async savePass(ownerId: string, bookingId: string, pass: CheckInPass): Promise<void> {
    const checkIn = await this.prisma.checkIn.findFirst({ where: { ownerId, bookingId }, select: { id: true } });
    if (!checkIn) throw new DomainError('NOT_FOUND');
    await this.prisma.boardingPass.createMany({ data: [{ ...pass, checkInId: checkIn.id, bookingId, ownerId }], skipDuplicates: true });
  }

  async complete(ownerId: string, result: CheckInResult): Promise<void> {
    const updated = await this.prisma.checkIn.updateMany({ where: { ownerId, bookingId: result.bookingId }, data: { status: result.status, result: result as unknown as Prisma.InputJsonValue } });
    if (updated.count !== 1) throw new DomainError('NOT_FOUND');
  }
  async abort(ownerId: string, bookingId: string): Promise<void> {
    await this.prisma.checkIn.deleteMany({ where: { ownerId, bookingId } });
  }
  async restore(ownerId: string, result: CheckInResult): Promise<void> {
    const preserved = result.checkedInPassengers.flatMap((passenger) => passenger.segments.filter((segment) => segment.status === 'CHECKED_IN').map((segment) => ({ passengerId: passenger.passengerId, segmentId: segment.segmentId })));
    const maxWait = Number(process.env.OPERATIONS_TX_MAX_WAIT_MS ?? '4000');
    const timeout = Number(process.env.OPERATIONS_TX_TIMEOUT_MS ?? '4000');
    if (![maxWait, timeout].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid Operations transaction timeout');
    await this.prisma.$transaction(async (tx) => {
      await tx.boardingPass.deleteMany({ where: { ownerId, bookingId: result.bookingId, ...(preserved.length ? { NOT: { OR: preserved } } : {}) } });
      await tx.checkIn.updateMany({ where: { ownerId, bookingId: result.bookingId }, data: { status: result.status, result: result as unknown as Prisma.InputJsonValue } });
    }, { maxWait, timeout });
  }
  async listPasses(ownerId: string, bookingId: string): Promise<CheckInPass[]> {
    const rows = await this.prisma.boardingPass.findMany({ where: { ownerId, bookingId, valid: true }, select: { passengerId: true, segmentId: true, seat: true, barcode: true, barcodeType: true } });
    return rows.map((row) => {
      if (row.barcodeType !== 'QR') throw new Error('Unsupported boarding pass barcode type');
      return { ...row, barcodeType: 'QR' };
    });
  }
  async claimStale(_now: Date, staleBefore: Date, limit: number): Promise<Array<{ ownerId: string; bookingId: string }>> {
    const candidates = await this.prisma.checkIn.findMany({ where: { status: 'IN_PROGRESS', updatedAt: { lte: staleBefore } }, orderBy: { updatedAt: 'asc' }, take: limit, select: { ownerId: true, bookingId: true, updatedAt: true } });
    const claimed: Array<{ ownerId: string; bookingId: string }> = [];
    for (const candidate of candidates) {
      const update = await this.prisma.checkIn.updateMany({ where: { ownerId: candidate.ownerId, bookingId: candidate.bookingId, status: 'IN_PROGRESS', updatedAt: { lte: staleBefore } }, data: { status: 'RECOVERING' } });
      if (update.count === 1) claimed.push({ ownerId: candidate.ownerId, bookingId: candidate.bookingId });
    }
    return claimed;
  }
  async releaseRecoveryClaim(ownerId: string, bookingId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const checkIn = await tx.checkIn.findFirst({ where: { ownerId, bookingId, status: 'RECOVERING' }, select: { id: true } });
      if (!checkIn) return;
      await tx.boardingPass.deleteMany({ where: { checkInId: checkIn.id } });
      await tx.checkIn.delete({ where: { id: checkIn.id } });
    }, transactionOptions());
  }
  async markBlocked(ownerId: string, bookingId: string): Promise<void> {
    await this.prisma.checkIn.upsert({ where: { bookingId }, create: { ownerId, bookingId, status: 'IN_PROGRESS' }, update: { ownerId, status: 'IN_PROGRESS', result: Prisma.DbNull, eventPublished: false } });
  }
  async listUnpublished(limit: number): Promise<Array<{ ownerId: string; bookingId: string }>> {
    const rows = await this.prisma.checkIn.findMany({ where: { result: { not: Prisma.DbNull }, eventPublished: false, status: { in: ['COMPLETED', 'FAILED'] } }, orderBy: { updatedAt: 'asc' }, take: limit, select: { ownerId: true, bookingId: true, result: true } });
    return rows.filter((row) => {
      const result = row.result as unknown as CheckInResult;
      return result.checkedInPassengers?.some((passenger) => passenger.segments.some((segment) => segment.status === 'CHECKED_IN'));
    }).map(({ ownerId, bookingId }) => ({ ownerId, bookingId }));
  }
  async markEventPublished(ownerId: string, bookingId: string): Promise<void> { await this.prisma.checkIn.updateMany({ where: { ownerId, bookingId }, data: { eventPublished: true } }); }
}

function transactionOptions() {
  const maxWait = Number(process.env.OPERATIONS_TX_MAX_WAIT_MS ?? '4000');
  const timeout = Number(process.env.OPERATIONS_TX_TIMEOUT_MS ?? '4000');
  if (![maxWait, timeout].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid Operations transaction timeout');
  return { maxWait, timeout };
}
