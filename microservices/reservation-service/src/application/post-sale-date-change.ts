import { DomainError, flightLocalDay } from '@flight-platform/shared';
import { assertPostSaleEligible, PostSaleItinerary } from '../domain/post-sale-eligibility';
import { PricingPort } from './ports';
import { ReservationStore, StoredReservation } from './reservation-store';
import { ResponseValidator } from './post-sale-baggage';

type Passenger = { passengerType?: 'ADULT' | 'YOUTH' | 'CHILD' | 'INFANT' };
type Snapshot = PostSaleItinerary & { segments: Array<{ departure: { at: string; iataCode?: string } }>; itineraryId: string; pricingOptions: Array<{ fareRules?: { isChangeable?: boolean } }> };

export class SearchDateChange {
  constructor(private readonly reservations: ReservationStore, private readonly pricing: PricingPort, private readonly now: () => Date, private readonly validateResponse: ResponseValidator) {}

  async execute(input: { bookingId: string; ownerId: string; changes: Array<{ itineraryId: string; newDepartureDate: string }> }) {
    const booking = await this.reservations.findById(input.ownerId, input.bookingId);
    if (!booking) throw new DomainError('NOT_FOUND');
    const itineraries = booking.itineraries as Snapshot[];
    assertPostSaleEligible(booking.status, itineraries, this.now());
    if (itineraries.some((itinerary) => !Array.isArray(itinerary.pricingOptions) || !itinerary.pricingOptions.some((option) => option.fareRules?.isChangeable))) throw new DomainError('FARE_NOT_CHANGEABLE');
    const selections = new Set<string>();
    for (const change of input.changes) {
      const itinerary = itineraries.find((item) => item.itineraryId === change.itineraryId);
      if (!itinerary || selections.has(change.itineraryId)) throw new DomainError('VALIDATION_FAILED');
      selections.add(change.itineraryId);
      // NFR-TI-01: la nueva fecha es local al origen del itinerario y debe ser posterior al día local de hoy allí.
      const origin = itinerary.segments[0]?.departure.iataCode;
      const today = origin ? flightLocalDay(this.now(), origin, 'searchDateChange') : this.now().toISOString().slice(0, 10);
      if (!Number.isFinite(Date.parse(`${change.newDepartureDate}T00:00:00.000Z`)) || change.newDepartureDate <= today) throw new DomainError('VALIDATION_FAILED');
    }
    if (input.changes.length === 0) throw new DomainError('VALIDATION_FAILED');
    if (!this.pricing.quoteChange) throw new DomainError('VALIDATION_FAILED');
    const mix = this.passengerMix(booking);
    const result = await this.pricing.quoteChange({ bookingId: booking.id, ownerId: input.ownerId, changes: input.changes, currentItineraries: itineraries, passengers: mix });
    this.validateResponse('DateChangeSearchResponse', result.offers);
    return result.offers;
  }

  private passengerMix(booking: StoredReservation) {
    const passengers = booking.passengers as Passenger[];
    return {
      adults: passengers.filter((p) => p.passengerType === 'ADULT').length,
      youths: passengers.filter((p) => p.passengerType === 'YOUTH').length,
      children: passengers.filter((p) => p.passengerType === 'CHILD').length,
      infants: passengers.filter((p) => p.passengerType === 'INFANT').length,
    };
  }
}
