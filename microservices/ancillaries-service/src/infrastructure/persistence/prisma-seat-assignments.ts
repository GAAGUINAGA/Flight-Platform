import { Prisma } from './prisma-client/client';
import { Assignment, AssignmentStore, AtomicSeatChanges, SeatChangeOutcome, SeatChangePlan } from '../../application/seat-assignments';
import { DomainError } from '@flight-platform/shared';
import { PrismaClient } from './prisma-client/client';

const map = (value: { bookingId: string; ownerId: string; passengerId: string; segmentId: string; flightInstanceId: string; seatNumber: string; passengerType: string; cabinClass: string; status: string }): Assignment => ({ ...value, passengerType: value.passengerType as Assignment['passengerType'], status: value.status as Assignment['status'] });
export class PrismaSeatAssignmentStore implements AssignmentStore, AtomicSeatChanges {
  constructor(private readonly prisma: PrismaClient) {}
  async changeMany(plan: SeatChangePlan[]): Promise<SeatChangeOutcome[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const where = (item: SeatChangePlan) => ({ bookingId_passengerId_segmentId: { bookingId: item.bookingId, passengerId: item.passengerId, segmentId: item.segmentId } });
        const rows = await Promise.all(plan.map((item) => tx.seatAssignment.findUnique({ where: where(item) })));
        if (rows.some((row, index) => row && row.ownerId !== plan[index].ownerId)) throw new DomainError('NOT_FOUND');
        if (rows.some((row) => row?.status === 'CHECKED_IN')) throw new DomainError('CUTOFF_PASSED');
        // Fase 1: los asientos que se mueven pasan a un valor temporal para que dos pasajeros puedan intercambiarse sin chocar con el índice único.
        for (const [index, row] of rows.entries()) if (row && row.status !== 'RELEASED' && row.seatNumber !== plan[index].seatNumber) await tx.seatAssignment.update({ where: where(plan[index]), data: { seatNumber: `~${index}` } });
        const outcomes: SeatChangeOutcome[] = [];
        for (const [index, item] of plan.entries()) {
          const row = rows[index]; const active = row && row.status !== 'RELEASED';
          const saved = row
            ? await tx.seatAssignment.update({ where: where(item), data: { seatNumber: item.seatNumber, cabinClass: item.cabinClass, passengerType: item.passengerType, flightInstanceId: item.flightInstanceId, ...(active ? {} : { status: item.newStatus }) } })
            : await tx.seatAssignment.create({ data: { bookingId: item.bookingId, ownerId: item.ownerId, passengerId: item.passengerId, segmentId: item.segmentId, flightInstanceId: item.flightInstanceId, seatNumber: item.seatNumber, passengerType: item.passengerType, cabinClass: item.cabinClass, status: item.newStatus } });
          outcomes.push({ passengerId: item.passengerId, segmentId: item.segmentId, ...(active ? { previousSeatNumber: row.seatNumber } : {}), seatNumber: saved.seatNumber, status: saved.status as SeatChangeOutcome['status'] });
        }
        return outcomes;
      });
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DomainError('SEAT_TAKEN'); throw error; }
  }
  async create(value: Assignment): Promise<Assignment> {
    try { return map(await this.prisma.seatAssignment.create({ data: value })); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DomainError('SEAT_TAKEN'); throw error; }
  }
  async find(bookingId: string, ownerId: string, passengerId: string, segmentId: string): Promise<Assignment | null> {
    const value = await this.prisma.seatAssignment.findFirst({ where: { bookingId, ownerId, passengerId, segmentId } }); return value ? map(value) : null;
  }
  async list(bookingId: string, ownerId: string): Promise<Assignment[]> { return (await this.prisma.seatAssignment.findMany({ where: { bookingId, ownerId } })).map(map); }
  async updateStatus(bookingId: string, ownerId: string, status: 'CONFIRMED' | 'RELEASED'): Promise<Assignment[]> {
    await this.prisma.seatAssignment.updateMany({ where: { bookingId, ownerId, status: status === 'CONFIRMED' ? 'PROVISIONAL' : { not: 'RELEASED' } }, data: { status } });
    return this.list(bookingId, ownerId);
  }
  async markCheckedIn(bookingId: string, ownerId: string, passengerId: string, segmentId: string): Promise<Assignment> {
    try { return map(await this.prisma.seatAssignment.update({ where: { bookingId_passengerId_segmentId: { bookingId, passengerId, segmentId }, ownerId, status: { in: ['PROVISIONAL', 'CONFIRMED', 'CHECKED_IN'] } }, data: { status: 'CHECKED_IN' } })); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new DomainError('NOT_FOUND'); throw error; }
  }
  async activeSeatNumbers(flightInstanceId: string): Promise<string[]> { return (await this.prisma.seatAssignment.findMany({ where: { flightInstanceId, status: { not: 'RELEASED' } }, select: { seatNumber: true } })).map((value) => value.seatNumber); }
}
