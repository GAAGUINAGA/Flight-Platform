import { randomUUID } from 'node:crypto';
import { Clock, DomainError, decimalToMinor, minorToDecimal, validate } from '@flight-platform/shared';
import { CabinPricingView, Fare, OfferSnapshot } from './search-offers';
import { InventoryGateway } from './ports';
import { calculateFare } from '../domain/pricing';
import { baggagePriceRequest, changeOfferRequest, quoteCancellationRequest, quoteChangeRequest } from './schemas';

export interface ChangeOffer { id: string; bookingId: string; ownerId: string; snapshot: ChangeSnapshot; expiresAt: Date; usedAt?: Date }
export interface ChangeSnapshot { segments: unknown[]; fareDifference: string; taxDifference: string; changeFee: string; totalToPay: string }
export interface PostSaleStore { saveChangeOffer(value: ChangeOffer): Promise<void>; findChangeOffer(id: string, ownerId: string): Promise<ChangeOffer | null>; markChangeOfferUsed(id: string, ownerId: string, at: Date): Promise<boolean>; findActiveOffers(now: Date): Promise<OfferSnapshot[]>; findFares(ids: string[]): Promise<Fare[]> }
export interface PostSaleConfig { changeOfferTtlMinutes: number; changeFeeMinor: number; cancelPenaltyMinor: number; currency: string }

export class PostSalePricing {
  constructor(private readonly store: PostSaleStore, private readonly inventory: InventoryGateway, private readonly clock: Clock, private readonly config: PostSaleConfig) {}
  async quoteChange(input: unknown) {
    const request = validate(quoteChangeRequest, input);
    const itineraries = request.currentItineraries as Array<{ itineraryId: string; segments: unknown[]; pricingOptions: CabinPricingView[] }>;
    const seats = request.passengers.adults + request.passengers.youths + request.passengers.children;
    const offers: ChangeOffer[] = await Promise.all(request.changes.map(async (change) => {
      const itinerary = itineraries.find((item) => item.itineraryId === change.itineraryId);
      const selected = itinerary?.pricingOptions[0];
      if (!selected || !selected.fareRules.isChangeable) throw new DomainError('FARE_NOT_CHANGEABLE');
      const first = itinerary.segments[0] as { departure?: { iataCode?: string } } | undefined;
      const last = itinerary.segments.at(-1) as { arrival?: { iataCode?: string } } | undefined;
      const origin = first?.departure?.iataCode;
      const destination = last?.arrival?.iataCode;
      if (!origin || !destination) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
      const flights = await this.inventory.queryAvailability({ origin, destination, departureDate: change.newDepartureDate, passengers: request.passengers, cabinClass: selected.cabinClass });
      if (flights.length === 0) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
      const fares = await this.store.findFares(flights.map((flight) => flight.segment.flightInstanceId));
      const newFare = fares.find((fare) => fare.flightInstanceId === flights[0].segment.flightInstanceId && fare.cabinClass === selected.cabinClass && fare.brand === selected.fareBrand);
      if (!newFare) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
      const previous = selected.pricePerPassengerType.find((price) => price.passengerType === 'TOTAL')?.price;
      if (!previous?.baseFare || !previous.taxes) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
      const newPrice = calculateFare(newFare.baseFareMinor, newFare.taxesMinor, request.passengers).total.amountMinor;
      const oldBase = decimalToMinor(previous.baseFare);
      const oldTaxes = decimalToMinor(previous.taxes);
      const newBase = this.componentTotal(newFare.baseFareMinor, request.passengers);
      const newTaxes = this.componentTotal(newFare.taxesMinor, request.passengers);
      const fee = seats * this.config.changeFeeMinor;
      const fareDifference = newBase - oldBase;
      const taxDifference = newTaxes - oldTaxes;
      const priceIncrease = Math.max(0, newPrice - decimalToMinor(previous.total));
      return { id: randomUUID(), bookingId: request.bookingId, ownerId: request.ownerId, expiresAt: new Date(this.clock.now().getTime() + this.config.changeOfferTtlMinutes * 60_000), snapshot: { segments: flights.map((flight) => flight.segment), fareDifference: minorToDecimal(fareDifference), taxDifference: minorToDecimal(taxDifference), changeFee: minorToDecimal(fee), totalToPay: minorToDecimal(priceIncrease + fee) } };
    }));
    await Promise.all(offers.map((offer) => this.store.saveChangeOffer(offer)));
    return { offers: offers.map((offer) => this.view(offer)) };
  }
  async getChangeOffer(input: unknown) {
    const request = validate(changeOfferRequest, input);
    const offer = await this.store.findChangeOffer(request.changeOfferId, request.ownerId);
    if (!offer || offer.usedAt || offer.expiresAt <= this.clock.now()) throw new DomainError('CHANGE_OFFER_EXPIRED');
    return this.view(offer);
  }
  async markChangeOfferUsed(input: unknown): Promise<void> {
    const request = validate(changeOfferRequest, input);
    if (!await this.store.markChangeOfferUsed(request.changeOfferId, request.ownerId, this.clock.now())) throw new DomainError('CHANGE_OFFER_EXPIRED');
  }
  quoteCancellation(input: unknown) {
    const request = validate(quoteCancellationRequest, input);
    const total = decimalToMinor(request.paidPrice.total);
    const taxes = request.paidPrice.taxes ? decimalToMinor(request.paidPrice.taxes) : 0;
    const penalty = request.fareRules.isRefundable ? Math.min(total, this.config.cancelPenaltyMinor) : Math.max(0, total - taxes);
    return { quoteId: randomUUID(), isRefundable: request.fareRules.isRefundable, refundAmount: minorToDecimal(Math.max(0, total - penalty)), penaltyAmount: minorToDecimal(penalty), currency: this.config.currency, expiresAt: new Date(this.clock.now().getTime() + this.config.changeOfferTtlMinutes * 60_000).toISOString() };
  }
  async getBaggagePrice(input: unknown) {
    const request = validate(baggagePriceRequest, input);
    for (const offer of await this.store.findActiveOffers(this.clock.now())) {
      const option = offer.itineraries.find((itinerary) => itinerary.itineraryId === request.itineraryId)?.pricingOptions.find((item) => item.fareBrand === request.fareBrand);
      if (option) return option.extraCheckedBaggagePrice;
    }
    throw new DomainError('NOT_FOUND');
  }
  private componentTotal(amountMinor: number, passengers: { adults: number; youths: number; children: number; infants: number }): number {
    return amountMinor * passengers.adults + Math.round(amountMinor * 90 / 100) * passengers.youths + Math.round(amountMinor * 75 / 100) * passengers.children + Math.round(amountMinor * 10 / 100) * passengers.infants;
  }
  private view(offer: ChangeOffer) { return { changeOfferId: offer.id, expiresAt: offer.expiresAt.toISOString(), segments: offer.snapshot.segments, priceDifference: { fareDifference: offer.snapshot.fareDifference, taxDifference: offer.snapshot.taxDifference, changeFee: offer.snapshot.changeFee, totalToPay: offer.snapshot.totalToPay } }; }
}
