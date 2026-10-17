import { DomainError } from '@flight-platform/shared';

export interface PostSaleItinerary { segments: Array<{ departure: { at: string } }> }

export function assertPostSaleEligible(status: string, itineraries: PostSaleItinerary[], now: Date): void {
  if (status !== 'CONFIRMED') throw new DomainError('BOOKING_NOT_CONFIRMED');
  if (itineraries.length === 0 || itineraries.some((itinerary) => !Array.isArray(itinerary.segments) || itinerary.segments.length === 0)) throw new DomainError('VALIDATION_FAILED');
  for (const itinerary of itineraries) for (const segment of itinerary.segments) {
    const departure = Date.parse(segment.departure?.at ?? '');
    if (!Number.isFinite(departure)) throw new DomainError('VALIDATION_FAILED');
    if (departure <= now.getTime()) throw new DomainError('FLIGHT_ALREADY_DEPARTED');
  }
}
