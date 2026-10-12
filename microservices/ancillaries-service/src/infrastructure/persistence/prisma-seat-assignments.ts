import { Prisma } from './prisma-client/client';
import { Assignment, AssignmentStore } from '../../application/seat-assignments';
import { DomainError } from '@flight-platform/shared';
import { PrismaClient } from './prisma-client/client';

const map = (value: { bookingId: string; ownerId: string; passengerId: string; segmentId: string; flightInstanceId: string; seatNumber: string; passengerType: string; cabinClass: string; status: string }): Assignment => ({ ...value, passengerType: value.passengerType as Assignment['passengerType'], status: value.status as Assignment['status'] });
export class PrismaSeatAssignmentStore implements AssignmentStore {
  constructor(private readonly prisma: PrismaClient) {}
  async create(value: Assignment): Promise<Assignment> {
    try { return map(await this.prisma.seatAssignment.create({ data: value })); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DomainError('SEAT_TAKEN'); throw error; }
  }
  async find(bookingId: string, ownerId: string, passengerId: string, segmentId: string): Promise<Assignment | null> {
    const value = await this.prisma.seatAssignment.findFirst({ where: { bookingId, ownerId, passengerId, segmentId } }); return value ? map(value) : null;
  }
  async list(bookingId: string, ownerId: string): Promise<Assignment[]> { return (await this.prisma.seatAssignment.findMany({ where: { bookingId, ownerId } })).map(map); }
  async updateStatus(bookingId: string, ownerId: string, status: 'CONFIRMED' | 'RELEASED'): Promise<Assignment[]> {
    const result = await this.prisma.seatAssignment.updateMany({ where: { bookingId, ownerId, status: { not: 'RELEASED' } }, data: { status } });
    if (result.count === 0 && !(await this.prisma.seatAssignment.findFirst({ where: { bookingId, ownerId } }))) throw new DomainError('NOT_FOUND');
    return this.list(bookingId, ownerId);
  }
  async activeSeatNumbers(flightInstanceId: string): Promise<string[]> { return (await this.prisma.seatAssignment.findMany({ where: { flightInstanceId, status: { not: 'RELEASED' } }, select: { seatNumber: true } })).map((value) => value.seatNumber); }
}
