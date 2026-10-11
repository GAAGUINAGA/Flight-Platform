import { randomUUID } from 'node:crypto';
import { Clock, DomainError, validate } from '@flight-platform/shared';
import { calculateFare, PassengerMix } from '../domain/pricing';
import { AvailableFlight, CabinClass, InventoryGateway } from './ports';
import { resolveSegmentRequest, searchOffersRequest } from './schemas';

export interface Fare { flightInstanceId: string; cabinClass: CabinClass; brand: string; baseFareMinor: number; taxesMinor: number; rules: { changeable: boolean; refundable: boolean }; baggage: { personalItemIncluded?: boolean; carryOnIncluded?: number; checkedBags?: number }; extraBagMinor: number }
export interface OfferSnapshot { offerId: string; airlineCode: string; airlineName: string; itineraries: ItineraryView[]; grandTotal: MoneyAmount }
export interface MoneyAmount { currency: string; baseFare?: string; taxes?: string; total: string }
export interface ItineraryView { itineraryId: string; totalDurationMinutes: number; stopsCount: number; segments: SegmentView[]; pricingOptions: CabinPricingView[] }
export interface SegmentView { segmentId: string; flightInstanceId: string; flightNumber: string; departure: { iataCode: string; at: string }; arrival: { iataCode: string; at: string }; marketingCarrier: string; operatingCarrier: string; aircraft?: string; durationMinutes?: number }
export interface CabinPricingView { cabinClass: CabinClass; fareBrand: string; availableSeats: number; fareRules: { isRefundable: boolean; isChangeable: boolean }; baggageAllowance: { personalItemIncluded?: boolean; carryOnIncluded?: number; checkedBaggageIncluded?: number }; extraCheckedBaggagePrice: MoneyAmount; pricePerPassengerType: Array<{ passengerType: string; price: MoneyAmount }> }
export interface OfferStore { findFares(ids: string[]): Promise<Fare[]>; saveOffer(snapshot: OfferSnapshot, mix: PassengerMix, expiresAt: Date): Promise<void>; findActiveOffers(now: Date): Promise<OfferSnapshot[]> }
export interface SearchConfig { offerTtlMinutes: number; currency: string; airlineCode: string; airlineName: string }

const decimal = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
const money = (minor: number, currency: string, baseFare?: number, taxes?: number): MoneyAmount => ({ currency, total: decimal(minor), ...(baseFare === undefined ? {} : { baseFare: decimal(baseFare) }), ...(taxes === undefined ? {} : { taxes: decimal(taxes) }) });
const segments = (flights: AvailableFlight[]): SegmentView[] => flights.map(({ segment }) => ({ ...segment }));

export class SearchOffers {
  constructor(private readonly inventory: InventoryGateway, private readonly offers: OfferStore, private readonly clock: Clock, private readonly config: SearchConfig) {}

  async execute(input: unknown): Promise<{ totalOffers: number; offers: OfferSnapshot[] }> {
    const request = validate(searchOffersRequest, input);
    const mix = request.passengers;
    const seated = mix.adults + mix.youths + mix.children;
    if (mix.adults < 1 || mix.infants > mix.adults || seated > 9 || request.legs.some((leg) => leg.origin === leg.destination)) throw new DomainError('VALIDATION_FAILED');
    const byLeg = await Promise.all(request.legs.map((leg) => this.inventory.queryAvailability({ ...leg, passengers: mix })));
    if (byLeg.some((flights) => flights.length === 0)) return { totalOffers: 0, offers: [] };
    // Una oferta contiene un itinerario por tramo solicitado; la búsqueda conserva la primera alternativa disponible por tramo.
    const selected = byLeg.map((flights) => flights[0]);
    const fares = await this.offers.findFares(selected.map((flight) => flight.segment.flightInstanceId));
    const itineraries = selected.map((flight) => this.itinerary(flight, fares, mix));
    if (itineraries.some((itinerary) => itinerary.pricingOptions.length === 0)) return { totalOffers: 0, offers: [] };
    const grandTotalMinor = itineraries.reduce((sum, itinerary) => sum + Math.min(...itinerary.pricingOptions.map((option) => Number(option.pricePerPassengerType.find((price) => price.passengerType === 'TOTAL')?.price.total.replace('.', '')))), 0);
    const snapshot: OfferSnapshot = { offerId: randomUUID(), airlineCode: this.config.airlineCode, airlineName: this.config.airlineName, itineraries, grandTotal: money(grandTotalMinor, this.config.currency) };
    await this.offers.saveOffer(snapshot, mix, new Date(this.clock.now().getTime() + this.config.offerTtlMinutes * 60_000));
    return { totalOffers: 1, offers: [snapshot] };
  }

  async resolveSegment(input: unknown): Promise<SegmentView> {
    const { segmentId } = validate(resolveSegmentRequest, input);
    for (const offer of await this.offers.findActiveOffers(this.clock.now())) {
      for (const itinerary of offer.itineraries) {
        const segment = itinerary.segments.find((item) => item.segmentId === segmentId);
        if (segment) return segment;
      }
    }
    throw new DomainError('NOT_FOUND');
  }

  private itinerary(flight: AvailableFlight, fares: Fare[], mix: PassengerMix): ItineraryView {
    const matched = fares.filter((fare) => fare.flightInstanceId === flight.segment.flightInstanceId && fare.cabinClass === flight.cabinClass);
    const pricingOptions = matched.map((fare) => {
      const calculated = calculateFare(fare.baseFareMinor, fare.taxesMinor, mix);
      const multiplier: Record<keyof PassengerMix, number> = { adults: 100, youths: 90, children: 75, infants: 10 };
      const prices = (Object.entries(calculated.perType) as Array<[keyof PassengerMix, { currency: 'USD'; amountMinor: number }]>).map(([type, value]) => {
        const base = Math.round(fare.baseFareMinor * multiplier[type] / 100);
        const taxes = Math.round(fare.taxesMinor * multiplier[type] / 100);
        return { passengerType: type.toUpperCase().slice(0, -1), price: money(value.amountMinor, this.config.currency, base, taxes) };
      });
      const totalBase = (Object.keys(mix) as Array<keyof PassengerMix>).reduce((sum, type) => sum + Math.round(fare.baseFareMinor * multiplier[type] / 100) * mix[type], 0);
      const totalTaxes = (Object.keys(mix) as Array<keyof PassengerMix>).reduce((sum, type) => sum + Math.round(fare.taxesMinor * multiplier[type] / 100) * mix[type], 0);
      prices.push({ passengerType: 'TOTAL', price: money(calculated.total.amountMinor, this.config.currency, totalBase, totalTaxes) });
      return { cabinClass: fare.cabinClass, fareBrand: fare.brand, availableSeats: flight.availableSeats, fareRules: { isRefundable: fare.rules.refundable, isChangeable: fare.rules.changeable }, baggageAllowance: { personalItemIncluded: fare.baggage.personalItemIncluded, carryOnIncluded: fare.baggage.carryOnIncluded, checkedBaggageIncluded: fare.baggage.checkedBags }, extraCheckedBaggagePrice: money(fare.extraBagMinor, this.config.currency), pricePerPassengerType: prices };
    });
    return { itineraryId: randomUUID(), totalDurationMinutes: flight.segment.durationMinutes ?? Math.max(0, Math.round((Date.parse(flight.segment.arrival.at) - Date.parse(flight.segment.departure.at)) / 60_000)), stopsCount: 0, segments: segments([flight]), pricingOptions };
  }
}
