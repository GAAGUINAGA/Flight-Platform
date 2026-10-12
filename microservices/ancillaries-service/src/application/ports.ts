import { Observable } from 'rxjs';

export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

export interface Segment { segmentId: string; flightInstanceId: string; aircraft?: string; }
export interface InventoryGateway { getFlightInstance(id: string): Promise<{ aircraft?: string }>; }
export interface PricingGateway { resolveSegment(input: { segmentId: string }): Promise<Segment>; getBaggagePrice(input: { itineraryId: string; fareBrand: string }): Promise<{ currency: string; total: string }>; }

export interface InventoryGrpcService { getFlightInstance(input: unknown): Observable<{ segment?: { aircraft?: string }; aircraft?: string }>; }
export interface PricingGrpcService {
  resolveSegment(input: unknown): Observable<{ segment?: Segment }>;
  getBaggagePrice(input: unknown): Observable<{ currency: string; total: string }>;
}
