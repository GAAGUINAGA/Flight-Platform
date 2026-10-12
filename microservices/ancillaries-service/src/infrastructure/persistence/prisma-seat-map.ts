import { SeatAvailabilityStore, SeatLayoutStore } from '../../application/seat-map';
import { PrismaClient } from './prisma-client/client';

export class PrismaSeatMapStore implements SeatLayoutStore, SeatAvailabilityStore {
  constructor(private readonly prisma: PrismaClient) {}
  async listByAircraft(aircraft: string) {
    return this.prisma.seatLayout.findMany({ where: { aircraft }, orderBy: [{ cabinClass: 'asc' }, { rowNumber: 'asc' }, { seatNumber: 'asc' }], select: { cabinClass: true, seatNumber: true, rowNumber: true, characteristics: true } });
  }
  async activeSeatNumbers(flightInstanceId: string): Promise<string[]> {
    const rows = await this.prisma.seatAssignment.findMany({ where: { flightInstanceId, status: { not: 'RELEASED' } }, select: { seatNumber: true } });
    return rows.map((row) => row.seatNumber);
  }
}
