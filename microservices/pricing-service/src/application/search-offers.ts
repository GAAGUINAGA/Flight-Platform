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
export interface SearchConfig { offerTtlMinutes: number; currency: string; airlineCode: string; airlineName: string; maxOffers?: number; maxCandidatesPerLeg?: number }

const decimal = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
const money = (minor: number, currency: string, baseFare?: number, taxes?: number): MoneyAmount => ({ currency, total: decimal(minor), ...(baseFare === undefined ? {} : { baseFare: decimal(baseFare) }), ...(taxes === undefined ? {} : { taxes: decimal(taxes) }) });
interface FlightCabins { segment: AvailableFlight['segment']; cabins: Array<{ cabinClass: CabinClass; availableSeats: number }> }

/** Inventory devuelve una fila por vuelo y cabina; se agrupa por vuelo conservando el orden recibido. */
const groupByFlight = (rows: AvailableFlight[]): FlightCabins[] => {
  const flights = new Map<string, FlightCabins>();
  for (const row of rows) {
    const existing = flights.get(row.segment.flightInstanceId);
    if (existing) existing.cabins.push({ cabinClass: row.cabinClass, availableSeats: row.availableSeats });
    else flights.set(row.segment.flightInstanceId, { segment: row.segment, cabins: [{ cabinClass: row.cabinClass, availableSeats: row.availableSeats }] });
  }
  return [...flights.values()];
};
const totalMinor = (option: CabinPricingView) => Number(option.pricePerPassengerType.find((price) => price.passengerType === 'TOTAL')?.price.total.replace('.', ''));
const cheapestMinor = (itinerary: ItineraryView) => Math.min(...itinerary.pricingOptions.map(totalMinor));
/** Orden determinista de ofertas: precio total, luego salida del primer tramo y, al final, los vuelos por id. */
const compareCombination = (a: { items: Array<{ minor: number; departure: number; flight: FlightCabins }>; minor: number }, b: typeof a): number =>
  a.minor - b.minor || a.items[0].departure - b.items[0].departure || a.items.map((item) => item.flight.segment.flightInstanceId).join().localeCompare(b.items.map((item) => item.flight.segment.flightInstanceId).join());

export class SearchOffers {
  constructor(private readonly inventory: InventoryGateway, private readonly offers: OfferStore, private readonly clock: Clock, private readonly config: SearchConfig) {}

  async execute(input: unknown): Promise<{ totalOffers: number; offers: OfferSnapshot[] }> {
    const request = validate(searchOffersRequest, input);
    const mix = request.passengers;
    const seated = mix.adults + mix.youths + mix.children;
    if (mix.adults < 1 || mix.infants > mix.adults || seated > 9 || request.legs.some((leg) => leg.origin === leg.destination)) throw new DomainError('VALIDATION_FAILED');
    const byLeg = await Promise.all(request.legs.map((leg) => this.inventory.queryAvailability({ ...leg, passengers: mix })));
    if (byLeg.some((flights) => flights.length === 0)) return { totalOffers: 0, offers: [] };
    const limit = Math.max(1, this.config.maxOffers ?? 10);
    const configuredCandidates = this.config.maxCandidatesPerLeg ?? 100;
    if (!Number.isSafeInteger(configuredCandidates) || configuredCandidates < 1) throw new Error('Invalid SEARCH_MAX_CANDIDATES_PER_LEG');
    const candidateLimit = Math.max(limit + 1, configuredCandidates);
    const grouped = byLeg.map(groupByFlight);
    const fares = await this.offers.findFares(grouped.flatMap((flights) => flights.map((flight) => flight.segment.flightInstanceId)));
    // Candidatos por tramo: un vuelo con todas sus cabinas y marcas con tarifa; sin tarifa no se ofrece.
    const candidates = grouped.map((flights) => flights
      .map((flight) => ({ flight, itinerary: this.itinerary(flight, fares, mix) }))
      .filter(({ itinerary }) => itinerary.pricingOptions.length > 0)
      .map((candidate) => ({ ...candidate, minor: cheapestMinor(candidate.itinerary), departure: Date.parse(candidate.flight.segment.departure.at), arrival: Date.parse(candidate.flight.segment.arrival.at) }))
      .sort((a, b) => a.minor - b.minor || a.departure - b.departure || a.flight.segment.flightInstanceId.localeCompare(b.flight.segment.flightInstanceId))
    );
    if (candidates.some((leg) => leg.length === 0)) return { totalOffers: 0, offers: [] };
    type Candidate = (typeof candidates)[number][number];
    // Combinación por tramos con un haz acotado (limit parciales); un tramo debe salir después de llegar el anterior.
    type Combination = { items: Candidate[]; minor: number };
    let partials: Combination[] = [];
    let width = candidateLimit;
    do {
      const bounded = candidates.map((leg) => leg.slice(0, width));
      let suffixes: Combination[][] = bounded[bounded.length - 1].map((item) => [{ items: [item], minor: item.minor }]);
      for (let index = bounded.length - 2; index >= 0; index--) {
        const next = bounded[index + 1];
        suffixes = bounded[index].map((item) => next.flatMap((following, nextIndex) =>
          following.departure >= item.arrival
            ? suffixes[nextIndex].map((suffix) => ({ items: [item, ...suffix.items], minor: item.minor + suffix.minor }))
            : []
        ).sort(compareCombination).slice(0, limit));
      }
      partials = suffixes.flat().sort(compareCombination).slice(0, limit);
      if (partials.length || bounded.every((leg, index) => leg.length === candidates[index].length)) break;
      width *= 2;
    } while (width <= Math.max(...candidates.map((leg) => leg.length)) * 2);
    const expiresAt = new Date(this.clock.now().getTime() + this.config.offerTtlMinutes * 60_000);
    const offers = partials.map((partial): OfferSnapshot => ({
      offerId: randomUUID(), airlineCode: this.config.airlineCode, airlineName: this.config.airlineName,
      itineraries: partial.items.map(({ itinerary }) => ({ ...itinerary, itineraryId: randomUUID() })),
      grandTotal: money(partial.minor, this.config.currency)
    }));
    await Promise.all(offers.map((snapshot) => this.offers.saveOffer(snapshot, mix, expiresAt)));
    return { totalOffers: offers.length, offers };
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

  private itinerary(flight: FlightCabins, fares: Fare[], mix: PassengerMix): ItineraryView {
    // Opciones de la más barata a la más cara (luego cabina y marca): la primera es la tarifa de entrada del vuelo.
    const matched = fares
      .filter((fare) => fare.flightInstanceId === flight.segment.flightInstanceId && flight.cabins.some((cabin) => cabin.cabinClass === fare.cabinClass))
      .sort((a, b) => (a.baseFareMinor + a.taxesMinor) - (b.baseFareMinor + b.taxesMinor) || a.cabinClass.localeCompare(b.cabinClass) || a.brand.localeCompare(b.brand));
    const pricingOptions = matched.map((fare) => {
      const seats = flight.cabins.find((cabin) => cabin.cabinClass === fare.cabinClass)?.availableSeats ?? 0;
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
      return { cabinClass: fare.cabinClass, fareBrand: fare.brand, availableSeats: seats, fareRules: { isRefundable: fare.rules.refundable, isChangeable: fare.rules.changeable }, baggageAllowance: { personalItemIncluded: fare.baggage.personalItemIncluded, carryOnIncluded: fare.baggage.carryOnIncluded, checkedBaggageIncluded: fare.baggage.checkedBags }, extraCheckedBaggagePrice: money(fare.extraBagMinor, this.config.currency), pricePerPassengerType: prices };
    });
    return { itineraryId: randomUUID(), totalDurationMinutes: flight.segment.durationMinutes ?? Math.max(0, Math.round((Date.parse(flight.segment.arrival.at) - Date.parse(flight.segment.departure.at)) / 60_000)), stopsCount: 0, segments: [{ ...flight.segment }], pricingOptions };
  }
}
