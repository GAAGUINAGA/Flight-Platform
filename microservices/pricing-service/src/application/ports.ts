import { Observable } from 'rxjs';

export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

export interface InventorySegment {
  segmentId: string;
  flightInstanceId: string;
  flightNumber: string;
  departure: { iataCode: string; at: string };
  arrival: { iataCode: string; at: string };
  marketingCarrier: string;
  operatingCarrier: string;
  aircraft?: string;
  durationMinutes?: number;
}

export interface AvailableFlight {
  segment: InventorySegment;
  cabinClass: CabinClass;
  availableSeats: number;
}

export interface InventoryGateway {
  queryAvailability(request: { origin: string; destination: string; departureDate: string; passengers: PassengerMix; cabinClass?: CabinClass }): Promise<AvailableFlight[]>;
  createHold(request: { ownerId: string; segments: Array<{ flightInstanceId: string; cabinClass: CabinClass; seats: number }>; expiresAt: string; idempotencyKey: string }): Promise<InventoryHold>;
  getHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold>;
  releaseHold(request: { holdId: string; ownerId: string }): Promise<InventoryHold>;
}

export interface PassengerMix { adults: number; youths: number; children: number; infants: number }

export interface InventoryHold {
  holdId: string;
  ownerId: string;
  status: string;
  expiresAt: string;
  segments: Array<{ flightInstanceId: string; cabinClass: CabinClass; seats: number }>;
}

export interface InventoryGrpcService {
  queryAvailability(request: unknown): Observable<{ flights: Array<{ segment?: InventorySegment; cabinClass: CabinClass; availableSeats: number }> }>;
  createHold(request: unknown): Observable<InventoryHold>;
  getHold(request: unknown): Observable<InventoryHold>;
  releaseHold(request: unknown): Observable<InventoryHold>;
}
