import { firstValueFrom } from 'rxjs';
import { InventoryGateway, InventoryGrpcService, InventoryHold, AvailableFlight } from '../../application/ports';

/** Adaptador de salida: Pricing solo conoce su puerto, nunca Nest ni gRPC en application/domain. */
export class GrpcInventoryGateway implements InventoryGateway {
  constructor(private readonly client: InventoryGrpcService) {}

  async queryAvailability(request: { origin: string; destination: string; departureDate: string; passengers: { adults: number; youths: number; children: number; infants: number }; cabinClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST' }): Promise<AvailableFlight[]> {
    const response = await firstValueFrom(this.client.queryAvailability(request));
    return response.flights.flatMap((flight) => flight.segment ? [{ ...flight, segment: flight.segment }] : []);
  }

  createHold(request: { ownerId: string; segments: Array<{ flightInstanceId: string; cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'; seats: number }>; expiresAt: string; idempotencyKey: string }): Promise<InventoryHold> {
    return firstValueFrom(this.client.createHold(request));
  }

  getHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold> { return firstValueFrom(this.client.getHold(request)); }
  releaseHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold> { return firstValueFrom(this.client.releaseHold(request)); }
}
