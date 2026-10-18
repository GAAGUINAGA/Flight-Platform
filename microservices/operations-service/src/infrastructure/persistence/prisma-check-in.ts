import { DomainError } from '@flight-platform/shared';
import process from 'node:process';
import { CheckInPass, CheckInResult, CheckInStore } from '../../application/check-in-ports';
import { Prisma, PrismaClient } from './prisma-client/client';

export class PrismaCheckInStore implements CheckInStore {
  constructor(private readonly prisma: PrismaClient) {}

  async find(ownerId: string, bookingId: string): Promise<{ status: string; result: CheckInResult | null } | null> {
    const row = await this.prisma.checkIn.findFirst({ where: { ownerId, bookingId } });
    return row ? { status: row.status, result: row.result as unknown as CheckInResult | null } : null;
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
}
