import { DomainError } from '@flight-platform/shared';
import { InventoryGateway, PricingGateway, Segment } from '../../application/ports';

export class FakeInventoryGateway implements InventoryGateway {
  readonly aircraftByFlight = new Map<string, string>();
  async getFlightInstance(id: string): Promise<{ aircraft?: string }> { return { aircraft: this.aircraftByFlight.get(id) }; }
}

export class FakePricingGateway implements PricingGateway {
  readonly segments = new Map<string, Segment>();
  async resolveSegment({ segmentId }: { segmentId: string }): Promise<Segment> {
    const segment = this.segments.get(segmentId);
    if (!segment) throw new DomainError('NOT_FOUND');
    return segment;
  }
  async getBaggagePrice(): Promise<{ currency: string; total: string }> { return { currency: 'USD', total: '0.00' }; }
}
