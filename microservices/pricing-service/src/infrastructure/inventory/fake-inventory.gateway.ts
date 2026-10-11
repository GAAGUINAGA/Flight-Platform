import { AvailableFlight, InventoryGateway, InventoryHold } from '../../application/ports';
import { randomUUID } from 'node:crypto';

/** Adaptador determinista para pruebas de Pricing antes de levantar Inventory. */
export class FakeInventoryGateway implements InventoryGateway {
  private readonly holds = new Map<string, InventoryHold>();
  constructor(private readonly flights: AvailableFlight[] = []) {}

  async queryAvailability(request: { origin: string; destination: string; departureDate: string }): Promise<AvailableFlight[]> {
    return this.flights.filter((flight) =>
      flight.segment.departure.iataCode === request.origin &&
      flight.segment.arrival.iataCode === request.destination &&
      flight.segment.departure.at.slice(0, 10) === request.departureDate
    );
  }

  async createHold(request: { ownerId: string; segments: Array<{ flightInstanceId: string; cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'; seats: number }>; expiresAt: string }): Promise<InventoryHold> {
    const hold: InventoryHold = { holdId: randomUUID(), ownerId: request.ownerId, status: 'HELD', expiresAt: request.expiresAt, segments: request.segments };
    this.holds.set(hold.holdId, hold);
    return hold;
  }
  async getHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold> {
    const hold = this.holds.get(request.holdId);
    if (!hold || hold.ownerId !== request.ownerId) throw new Error('hold not found');
    return hold;
  }
  async releaseHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold> {
    const hold = await this.getHold(request);
    const released = { ...hold, status: 'RELEASED' };
    this.holds.set(hold.holdId, released);
    return released;
  }
}
