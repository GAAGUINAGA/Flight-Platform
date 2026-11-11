import { SeatAvailabilityStore, SeatLayoutStore } from '../../application/seat-map';
import { PrismaClient } from './prisma-client/client';

export class PrismaSeatMapStore implements SeatLayoutStore, SeatAvailabilityStore {
  constructor(private readonly prisma: PrismaClient) {}
  async listByAircraft(aircraft: string) {
    return this.prisma.seatLayout.findMany({ where: { aircraft }, orderBy: [{ cabinClass: 'asc' }, { rowNumber: 'asc' }, { seatNumber: 'asc' }], select: { cabinClass: true, seatNumber: true, rowNumber: true, characteristics: true } });
  }
  async activeSeatNumbers(flightInstanceId: string): Promise<string[]> {
    return [...(await this.seatStatuses(flightInstanceId, new Date())).keys()];
  }
  /** Solo lectura: una HELD con el vencimiento pasado se trata como libre sin escribir nada (la libera quien aparta). */
  async seatStatuses(flightInstanceId: string, now: Date): Promise<Map<string, string>> {
    const rows = await this.prisma.seatAssignment.findMany({ where: { flightInstanceId, OR: [{ status: { notIn: ['RELEASED', 'HELD'] } }, { status: 'HELD', holdExpiresAt: { gt: now } }] }, select: { seatNumber: true, status: true } });
    return new Map(rows.map((row) => [row.seatNumber, row.status]));
  }
}
