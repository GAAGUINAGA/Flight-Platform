import { validate } from '@flight-platform/shared';
import { z } from 'zod';
import { PricingGateway } from './ports';

const request = z.object({ offerId: z.string().uuid(), segmentId: z.string().uuid() }).strict();
export interface SeatLayoutRow { cabinClass: string; seatNumber: string; rowNumber: number; characteristics: string[]; }
export interface SeatLayoutStore { listByAircraft(aircraft: string): Promise<SeatLayoutRow[]>; }
export interface SeatAvailabilityStore { activeSeatNumbers(flightInstanceId: string): Promise<string[]>; }

export class GetSeatMapForOffer {
  constructor(private readonly pricing: PricingGateway, private readonly layouts: SeatLayoutStore, private readonly assignments: SeatAvailabilityStore) {}
  async execute(input: unknown): Promise<{ segmentId: string; cabins: Array<{ cabinClass: string; rows: Array<{ rowNumber: number; seats: Array<{ seatNumber: string; isAvailable: boolean; characteristics: string[] }> }> }> }> {
    const { segmentId } = validate(request, input);
    const segment = await this.pricing.resolveSegment({ segmentId });
    const layout = await this.layouts.listByAircraft(segment.aircraft ?? 'A320');
    const taken = new Set(await this.assignments.activeSeatNumbers(segment.flightInstanceId));
    const cabins = new Map<string, Map<number, SeatLayoutRow[]>>();
    for (const seat of layout) {
      const rows = cabins.get(seat.cabinClass) ?? new Map<number, SeatLayoutRow[]>();
      const seats = rows.get(seat.rowNumber) ?? [];
      seats.push(seat); rows.set(seat.rowNumber, seats); cabins.set(seat.cabinClass, rows);
    }
    return { segmentId: segment.segmentId, cabins: [...cabins.entries()].map(([cabinClass, rows]) => ({ cabinClass, rows: [...rows.entries()].sort(([left], [right]) => left - right).map(([rowNumber, seats]) => ({ rowNumber, seats: seats.sort((left, right) => left.seatNumber.localeCompare(right.seatNumber)).map((seat) => ({ seatNumber: seat.seatNumber, isAvailable: !taken.has(seat.seatNumber), characteristics: seat.characteristics })) })) })) };
  }
}
