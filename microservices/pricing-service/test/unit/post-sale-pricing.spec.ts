import { expect, it } from '@jest/globals';
import { PostSalePricing, ChangeOffer, PostSaleStore } from '../../src/application/post-sale-pricing';
import { Fare, OfferSnapshot } from '../../src/application/search-offers';
import { AvailableFlight } from '../../src/application/ports';

const itineraryId = '11111111-1111-4111-8111-111111111111';
const expensiveFlightId = '33333333-3333-4333-8333-333333333333';
const cheapFlightId = '44444444-4444-4444-8444-444444444444';
const currentItinerary = { itineraryId, totalDurationMinutes: 60, stopsCount: 0, segments: [{ segmentId: '55555555-5555-4555-8555-555555555555', flightInstanceId: '22222222-2222-4222-8222-222222222222', flightNumber: 'FP100', departure: { iataCode: 'UIO', at: '2026-12-01T13:00:00.000Z' }, arrival: { iataCode: 'GYE', at: '2026-12-01T14:00:00.000Z' }, marketingCarrier: 'FP', operatingCarrier: 'FP' }], pricingOptions: [{ cabinClass: 'ECONOMY' as const, fareBrand: 'FLEX', availableSeats: 1, fareRules: { isChangeable: true, isRefundable: true }, baggageAllowance: {}, extraCheckedBaggagePrice: { currency: 'USD', total: '50.00' }, pricePerPassengerType: [{ passengerType: 'TOTAL', price: { currency: 'USD', baseFare: '100.00', taxes: '20.00', total: '120.00' } }] }] };
const activeOffer: OfferSnapshot = { offerId: '22222222-2222-4222-8222-222222222222', airlineCode: 'FP', airlineName: 'Flight Platform', grandTotal: { currency: 'USD', total: '120.00' }, itineraries: [currentItinerary] };
const fare = (flightInstanceId: string, baseFareMinor: number, taxesMinor: number): Fare => ({ flightInstanceId, cabinClass: 'ECONOMY', brand: 'FLEX', baseFareMinor, taxesMinor, rules: { changeable: true, refundable: true }, baggage: {}, extraBagMinor: 5_000 });
const flight = (flightInstanceId: string, departureDate: string): AvailableFlight => ({ cabinClass: 'ECONOMY', availableSeats: 1, segment: { ...currentItinerary.segments[0], flightInstanceId, departure: { iataCode: 'UIO', at: `${departureDate}T13:00:00.000Z` }, arrival: { iataCode: 'GYE', at: `${departureDate}T14:00:00.000Z` } } });
class MemoryStore implements PostSaleStore {
  readonly changes = new Map<string, ChangeOffer>();
  constructor(readonly offers = [activeOffer], readonly fares = [fare(expensiveFlightId, 15_000, 3_000), fare(cheapFlightId, 8_000, 1_000)]) {}
  async saveChangeOffer(value: ChangeOffer) { this.changes.set(value.id, value); }
  async findChangeOffer(id: string, ownerId: string) { const value = this.changes.get(id); return value?.ownerId === ownerId ? value : null; }
  async markChangeOfferUsed(id: string, ownerId: string, at: Date) { const value = await this.findChangeOffer(id, ownerId); if (!value || value.usedAt || value.expiresAt <= at) return false; value.usedAt = at; return true; }
  async findActiveOffers() { return this.offers; }
  async findFares(ids: string[]) { return this.fares.filter((item) => ids.includes(item.flightInstanceId)); }
}
class MemoryInventory {
  constructor(private readonly flights: AvailableFlight[]) {}
  async queryAvailability(request: { departureDate: string }) { return this.flights.filter((item) => item.segment.departure.at.startsWith(request.departureDate)); }
}
const clock = { now: () => new Date('2026-12-01T00:00:00.000Z') };
const request = (newDepartureDate = '2026-12-15', changeable = true) => ({ bookingId: 'booking-1', ownerId: 'owner-1', changes: [{ itineraryId, newDepartureDate }], currentItineraries: [{ ...activeOffer.itineraries[0], pricingOptions: [{ ...activeOffer.itineraries[0].pricingOptions[0], fareRules: { isChangeable: changeable, isRefundable: true } }] }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });

describe('PRC-10/11: cotizaciones postventa', () => {
  it('PRC-10: tarifa no cambiable ⇒ FARE_NOT_CHANGEABLE', async () => {
    const service = new PostSalePricing(new MemoryStore(), new MemoryInventory([]), clock, { changeOfferTtlMinutes: 15, changeFeeMinor: 5000, cancelPenaltyMinor: 0, currency: 'USD' });
    await expect(service.quoteChange(request('2026-12-15', false))).rejects.toThrow('FARE_NOT_CHANGEABLE');
  });
  it('PRC-10: fecha con tarifa más cara calcula diferencias reales y ChangeOffer es de uso único', async () => {
    const store = new MemoryStore(); const service = new PostSalePricing(store, new MemoryInventory([flight(expensiveFlightId, '2026-12-15')]), clock, { changeOfferTtlMinutes: 15, changeFeeMinor: 5000, cancelPenaltyMinor: 0, currency: 'USD' });
    const quoted = await service.quoteChange(request());
    expect(quoted.offers[0].priceDifference).toEqual({ fareDifference: '50.00', taxDifference: '10.00', changeFee: '50.00', totalToPay: '110.00' });
    await service.markChangeOfferUsed({ changeOfferId: quoted.offers[0].changeOfferId, ownerId: 'owner-1' });
    await expect(service.getChangeOffer({ changeOfferId: quoted.offers[0].changeOfferId, ownerId: 'owner-1' })).rejects.toThrow('CHANGE_OFFER_EXPIRED');
  });
  it('PRC-10: fecha con tarifa más barata cobra solo changeFee y nunca un total negativo', async () => {
    const service = new PostSalePricing(new MemoryStore(), new MemoryInventory([flight(cheapFlightId, '2026-12-16')]), clock, { changeOfferTtlMinutes: 15, changeFeeMinor: 5000, cancelPenaltyMinor: 0, currency: 'USD' });
    await expect(service.quoteChange(request('2026-12-16'))).resolves.toMatchObject({ offers: [{ priceDifference: { fareDifference: '-20.00', taxDifference: '-10.00', changeFee: '50.00', totalToPay: '50.00' } }] });
  });
  it('PRC-10: fecha sin vuelos devuelve OFFER_NO_LONGER_AVAILABLE', async () => {
    const service = new PostSalePricing(new MemoryStore(), new MemoryInventory([]), clock, { changeOfferTtlMinutes: 15, changeFeeMinor: 5000, cancelPenaltyMinor: 0, currency: 'USD' });
    await expect(service.quoteChange(request())).rejects.toThrow('OFFER_NO_LONGER_AVAILABLE');
  });
  it('PRC-11: cancelación reembolsable descuenta penalidad y equipaje usa el brand de la oferta', async () => {
    const service = new PostSalePricing(new MemoryStore(), new MemoryInventory([]), clock, { changeOfferTtlMinutes: 15, changeFeeMinor: 5000, cancelPenaltyMinor: 2000, currency: 'USD' });
    expect(service.quoteCancellation({ bookingId: 'booking-1', ownerId: 'owner-1', paidPrice: { currency: 'USD', total: '120.00', taxes: '20.00' }, fareRules: { isRefundable: true, isChangeable: true } })).toMatchObject({ refundAmount: '100.00', penaltyAmount: '20.00' });
    await expect(service.getBaggagePrice({ itineraryId, fareBrand: 'FLEX' })).resolves.toEqual({ currency: 'USD', total: '50.00' });
  });
  it('PRC-11 / Q-033: cancelación no reembolsable devuelve solo las tasas', () => {
    const service = new PostSalePricing(new MemoryStore(), new MemoryInventory([]), clock, { changeOfferTtlMinutes: 15, changeFeeMinor: 5000, cancelPenaltyMinor: 2000, currency: 'USD' });
    expect(service.quoteCancellation({ bookingId: 'booking-1', ownerId: 'owner-1', paidPrice: { currency: 'USD', total: '120.00', taxes: '20.00' }, fareRules: { isRefundable: false, isChangeable: false } })).toMatchObject({ isRefundable: false, refundAmount: '20.00', penaltyAmount: '100.00' });
  });
});
