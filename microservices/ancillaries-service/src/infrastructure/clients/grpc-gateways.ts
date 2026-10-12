import { firstValueFrom } from 'rxjs';
import { InventoryGateway, InventoryGrpcService, PricingGateway, PricingGrpcService, Segment } from '../../application/ports';

export class GrpcInventoryGateway implements InventoryGateway {
  constructor(private readonly client: InventoryGrpcService) {}
  async getFlightInstance(id: string): Promise<{ aircraft?: string }> {
    const response = await firstValueFrom(this.client.getFlightInstance({ flightInstanceId: id }));
    return { aircraft: response.segment?.aircraft ?? response.aircraft };
  }
}

export class GrpcPricingGateway implements PricingGateway {
  constructor(private readonly client: PricingGrpcService) {}
  async resolveSegment(input: { segmentId: string }): Promise<Segment> {
    const response = await firstValueFrom(this.client.resolveSegment(input));
    if (!response.segment) throw new Error('Pricing returned no segment');
    return response.segment;
  }
  getBaggagePrice(input: { itineraryId: string; fareBrand: string }): Promise<{ currency: string; total: string }> {
    return firstValueFrom(this.client.getBaggagePrice(input));
  }
}
