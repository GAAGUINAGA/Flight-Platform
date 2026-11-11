import { Prisma } from './prisma-client/client';
import { Assignment, AssignmentStore, AtomicSeatChanges, HeldSeatRow, HeldSeatStore, heldPassengerId, SeatChangeOutcome, SeatChangePlan } from '../../application/seat-assignments';
import { DomainError } from '@flight-platform/shared';
import { PrismaClient } from './prisma-client/client';

const map = (value: { bookingId: string; ownerId: string; passengerId: string; segmentId: string; flightInstanceId: string; seatNumber: string; passengerType: string; cabinClass: string; status: string }): Assignment => ({ ...value, passengerType: value.passengerType as Assignment['passengerType'], status: value.status as Assignment['status'] });
type Db = Pick<PrismaClient, 'seatAssignment'>;
const isUnique = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
/** Libera las HELD vencidas de esos vuelos: el índice único parcial solo deja una asignación vigente por asiento, y una vencida no debe estorbar. */
const releaseExpired = (tx: Db, flightInstanceIds: string[], now: Date) => tx.seatAssignment.updateMany({ where: { flightInstanceId: { in: flightInstanceIds }, status: 'HELD', holdExpiresAt: { lte: now } }, data: { status: 'RELEASED' } });

export class PrismaSeatAssignmentStore implements AssignmentStore, AtomicSeatChanges, HeldSeatStore {
  constructor(private readonly prisma: PrismaClient) {}
  async holdMany(input: { holdId: string; ownerId: string; expiresAt: Date; seats: HeldSeatRow[] }): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await releaseExpired(tx, [...new Set(input.seats.map((seat) => seat.flightInstanceId))], new Date());
        for (const [index, seat] of input.seats.entries()) await tx.seatAssignment.create({ data: { bookingId: input.holdId, ownerId: input.ownerId, passengerId: heldPassengerId(input.holdId, index), segmentId: seat.segmentId, flightInstanceId: seat.flightInstanceId, seatNumber: seat.seatNumber, cabinClass: seat.cabinClass, passengerType: 'ADULT', status: 'HELD', holdId: input.holdId, holdExpiresAt: input.expiresAt } });
      });
    } catch (error) { if (isUnique(error)) throw new DomainError('SEAT_TAKEN'); throw error; }
  }
  async releaseHold(holdId: string, ownerId: string): Promise<void> { await this.prisma.seatAssignment.updateMany({ where: { holdId, ownerId, status: 'HELD' }, data: { status: 'RELEASED' } }); }
  async listHeld(holdId: string, ownerId: string, now: Date): Promise<Array<{ segmentId: string; seatNumber: string }>> {
    return this.prisma.seatAssignment.findMany({ where: { holdId, ownerId, status: 'HELD', holdExpiresAt: { gt: now } }, orderBy: { passengerId: 'asc' }, select: { segmentId: true, seatNumber: true } });
  }
  async reserveFromHold(input: { holdId: string; bookingId: string; ownerId: string; assignments: Assignment[] }): Promise<Assignment[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.seatAssignment.updateMany({ where: { holdId: input.holdId, ownerId: input.ownerId, status: 'HELD' }, data: { status: 'RELEASED', convertedBookingId: input.bookingId } });
        await releaseExpired(tx, [...new Set(input.assignments.map((item) => item.flightInstanceId))], new Date());
        const saved: Assignment[] = [];
        for (const item of input.assignments) saved.push(map(await tx.seatAssignment.create({ data: item })));
        return saved;
      });
    } catch (error) { if (isUnique(error)) throw new DomainError('SEAT_TAKEN'); throw error; }
  }
  async restoreHeld(bookingId: string, ownerId: string, now: Date): Promise<void> {
    const rows = await this.prisma.seatAssignment.findMany({ where: { convertedBookingId: bookingId, ownerId, status: 'RELEASED', holdExpiresAt: { gt: now } }, select: { id: true } });
    for (const row of rows) {
      // Una a una: si otro ya tomó ese asiento no se devuelve (queda libre) y no impide devolver los demás.
      try { await this.prisma.seatAssignment.update({ where: { id: row.id }, data: { status: 'HELD', convertedBookingId: null } }); } catch (error) { if (!isUnique(error)) throw error; }
    }
  }
  async changeMany(plan: SeatChangePlan[]): Promise<SeatChangeOutcome[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await releaseExpired(tx, [...new Set(plan.map((item) => item.flightInstanceId))], new Date());
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
    try { await releaseExpired(this.prisma, [value.flightInstanceId], new Date()); return map(await this.prisma.seatAssignment.create({ data: value })); }
    catch (error) { if (isUnique(error)) throw new DomainError('SEAT_TAKEN'); throw error; }
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
  async activeSeatNumbers(flightInstanceId: string): Promise<string[]> { return (await this.prisma.seatAssignment.findMany({ where: { flightInstanceId, OR: [{ status: { notIn: ['RELEASED', 'HELD'] } }, { status: 'HELD', holdExpiresAt: { gt: new Date() } }] }, select: { seatNumber: true } })).map((value) => value.seatNumber); }
}
