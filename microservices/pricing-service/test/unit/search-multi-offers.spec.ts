import { expect, it } from '@jest/globals';
import { Fare, OfferSnapshot, OfferStore, SearchOffers } from '../../src/application/search-offers';
import { AvailableFlight, CabinClass, InventoryGateway } from '../../src/application/ports';

const mix = { adults: 1, youths: 0, children: 0, infants: 0 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const flight = (n: number, origin: string, destination: string, depart: string, arrive: string, cabinClass: CabinClass = 'ECONOMY', availableSeats = 9): AvailableFlight => ({
  cabinClass, availableSeats,
  segment: { segmentId: uuid(n), flightInstanceId: uuid(n), flightNumber: `FP${n}`, departure: { iataCode: origin, at: depart }, arrival: { iataCode: destination, at: arrive }, marketingCarrier: 'FP', operatingCarrier: 'FP', durationMinutes: 60 }
});
const fare = (n: number, baseFareMinor: number, brand = 'BASIC', cabinClass: CabinClass = 'ECONOMY'): Fare => ({ flightInstanceId: uuid(n), cabinClass, brand, baseFareMinor, taxesMinor: 1_000, rules: { changeable: false, refundable: false }, baggage: {}, extraBagMinor: 5_000 });

class MemoryStore implements OfferStore {
  readonly saved: OfferSnapshot[] = [];
  constructor(private readonly fares: Fare[]) {}
  async findFares(ids: string[]) { return this.fares.filter((item) => ids.includes(item.flightInstanceId)); }
  async saveOffer(snapshot: OfferSnapshot) { this.saved.push(snapshot); }
  async findActiveOffers() { return this.saved; }
}
/** Inventory simulado: aplica el mismo filtro de capacidad que el real (cupo >= pasajeros con asiento). */
class MemoryInventory {
  constructor(private readonly flights: AvailableFlight[]) {}
  async queryAvailability(request: { origin: string; destination: string; departureDate: string; passengers: typeof mix }) {
    const needed = request.passengers.adults + request.passengers.youths + request.passengers.children;
    return this.flights.filter((item) => item.segment.departure.iataCode === request.origin && item.segment.arrival.iataCode === request.destination && item.segment.departure.at.startsWith(request.departureDate) && item.availableSeats >= needed);
  }
}
const clock = { now: () => new Date('2026-11-01T00:00:00.000Z') };
const build = (flights: AvailableFlight[], fares: Fare[], maxOffers = 10) => {
  const store = new MemoryStore(fares);
  const search = new SearchOffers(new MemoryInventory(flights) as unknown as InventoryGateway, store, clock, { offerTtlMinutes: 15, currency: 'USD', airlineCode: 'FP', airlineName: 'GabatAIR', maxOffers });
  return { store, search };
};
const oneWay = { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01' }], passengers: mix };
const roundTrip = { legs: [...oneWay.legs, { origin: 'GYE', destination: 'UIO', departureDate: '2026-12-05' }], passengers: mix };
const out = (offer: OfferSnapshot, leg = 0) => offer.itineraries[leg].segments[0].flightNumber;

describe('C: búsqueda con varias ofertas', () => {
  const uioGye = [flight(1, 'UIO', 'GYE', '2026-12-01T15:00:00.000Z', '2026-12-01T16:00:00.000Z'), flight(2, 'UIO', 'GYE', '2026-12-01T08:00:00.000Z', '2026-12-01T09:00:00.000Z'), flight(3, 'UIO', 'GYE', '2026-12-01T11:00:00.000Z', '2026-12-01T12:00:00.000Z')];
  const uioFares = [fare(1, 9_000), fare(2, 12_000), fare(3, 7_000)];

  it('C-01 / I: devuelve una oferta por vuelo del tramo, de la más barata a la más cara', async () => {
    const { search, store } = build(uioGye, uioFares);
    const result = await search.execute(oneWay);
    expect(result.totalOffers).toBe(3);
    expect(result.offers.map((offer) => out(offer))).toEqual(['FP3', 'FP1', 'FP2']);
    expect(result.offers.map((offer) => offer.grandTotal.total)).toEqual(['80.00', '100.00', '130.00']);
    expect(store.saved).toHaveLength(3);
  });

  it('C-02 / I: todas las cabinas y marcas con tarifa de un vuelo quedan como pricingOptions', async () => {
    const flights = [flight(1, 'UIO', 'GYE', '2026-12-01T08:00:00.000Z', '2026-12-01T09:00:00.000Z', 'ECONOMY', 5), flight(1, 'UIO', 'GYE', '2026-12-01T08:00:00.000Z', '2026-12-01T09:00:00.000Z', 'BUSINESS', 2)];
    const { search } = build(flights, [fare(1, 9_000, 'BASIC'), fare(1, 14_000, 'FLEX'), fare(1, 30_000, 'BUSINESS_FLEX', 'BUSINESS')]);
    const result = await search.execute(oneWay);
    expect(result.totalOffers).toBe(1);
    const options = result.offers[0].itineraries[0].pricingOptions;
    expect(options.map((option) => [option.cabinClass, option.fareBrand, option.availableSeats])).toEqual([['ECONOMY', 'BASIC', 5], ['ECONOMY', 'FLEX', 5], ['BUSINESS', 'BUSINESS_FLEX', 2]]);
    expect(result.offers[0].grandTotal.total).toBe('100.00');
  });

  it('C-03 / I: ida y vuelta combina los vuelos de ambos tramos por precio total', async () => {
    const back = [flight(11, 'GYE', 'UIO', '2026-12-05T10:00:00.000Z', '2026-12-05T11:00:00.000Z'), flight(12, 'GYE', 'UIO', '2026-12-05T18:00:00.000Z', '2026-12-05T19:00:00.000Z')];
    const { search } = build([...uioGye, ...back], [...uioFares, fare(11, 8_000), fare(12, 5_000)]);
    const result = await search.execute(roundTrip);
    expect(result.totalOffers).toBe(6);
    expect(result.offers.map((offer) => `${out(offer, 0)}+${out(offer, 1)}`)).toEqual(['FP3+FP12', 'FP1+FP12', 'FP3+FP11', 'FP2+FP12', 'FP1+FP11', 'FP2+FP11']);
    expect(result.offers.map((offer) => offer.grandTotal.total)).toEqual(['140.00', '160.00', '170.00', '190.00', '190.00', '220.00']);
    expect(new Set(result.offers.map((offer) => offer.offerId)).size).toBe(6);
    expect(new Set(result.offers.flatMap((offer) => offer.itineraries.map((item) => item.itineraryId))).size).toBe(12);
  });

  it('C-04 / I: respeta el límite de ofertas por respuesta y conserva las mejores', async () => {
    const { search, store } = build(uioGye, uioFares, 2);
    const result = await search.execute(oneWay);
    expect(result.offers.map((offer) => out(offer))).toEqual(['FP3', 'FP1']);
    expect(store.saved).toHaveLength(2);
    const back = [flight(11, 'GYE', 'UIO', '2026-12-05T10:00:00.000Z', '2026-12-05T11:00:00.000Z'), flight(12, 'GYE', 'UIO', '2026-12-05T18:00:00.000Z', '2026-12-05T19:00:00.000Z')];
    const combined = await build([...uioGye, ...back], [...uioFares, fare(11, 8_000), fare(12, 5_000)], 3).search.execute(roundTrip);
    expect(combined.offers.map((offer) => `${out(offer, 0)}+${out(offer, 1)}`)).toEqual(['FP3+FP12', 'FP1+FP12', 'FP3+FP11']);
  });

  it('C-05 / I: empate de precio ⇒ hora de salida y luego id de vuelo; el resultado es idéntico en cada llamada', async () => {
    const tied = [flight(21, 'UIO', 'GYE', '2026-12-01T14:00:00.000Z', '2026-12-01T15:00:00.000Z'), flight(23, 'UIO', 'GYE', '2026-12-01T09:00:00.000Z', '2026-12-01T10:00:00.000Z'), flight(22, 'UIO', 'GYE', '2026-12-01T14:00:00.000Z', '2026-12-01T15:00:00.000Z')];
    const { search } = build(tied, [fare(21, 9_000), fare(22, 9_000), fare(23, 9_000)]);
    const first = (await search.execute(oneWay)).offers.map((offer) => out(offer));
    const second = (await search.execute(oneWay)).offers.map((offer) => out(offer));
    expect(first).toEqual(['FP23', 'FP21', 'FP22']);
    expect(second).toEqual(first);
  });

  it('C-06 / I: un tramo sin vuelos ⇒ cero ofertas, aunque el otro tenga', async () => {
    const { search, store } = build(uioGye, uioFares);
    await expect(search.execute(roundTrip)).resolves.toEqual({ totalOffers: 0, offers: [] });
    expect(store.saved).toHaveLength(0);
  });

  it('C-07 / I: el vuelo sin capacidad para los pasajeros pedidos queda excluido', async () => {
    const flights = [flight(1, 'UIO', 'GYE', '2026-12-01T08:00:00.000Z', '2026-12-01T09:00:00.000Z', 'ECONOMY', 1), flight(2, 'UIO', 'GYE', '2026-12-01T10:00:00.000Z', '2026-12-01T11:00:00.000Z', 'ECONOMY', 3)];
    const { search } = build(flights, [fare(1, 5_000), fare(2, 9_000)]);
    const result = await search.execute({ ...oneWay, passengers: { ...mix, adults: 2 } });
    expect(result.offers.map((offer) => out(offer))).toEqual(['FP2']);
  });

  it('C-08 / I: un vuelo sin tarifa no se ofrece y, si ninguno tiene tarifa, no hay ofertas', async () => {
    const partial = await build(uioGye, [fare(1, 9_000)]).search.execute(oneWay);
    expect(partial.offers.map((offer) => out(offer))).toEqual(['FP1']);
    await expect(build(uioGye, []).search.execute(oneWay)).resolves.toEqual({ totalOffers: 0, offers: [] });
  });

  it('C-09 / I: en multidestino un tramo no puede salir antes de llegar el anterior', async () => {
    const legs = { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01' }, { origin: 'GYE', destination: 'UIO', departureDate: '2026-12-01' }], passengers: mix };
    const flights = [flight(1, 'UIO', 'GYE', '2026-12-01T08:00:00.000Z', '2026-12-01T09:00:00.000Z'), flight(11, 'GYE', 'UIO', '2026-12-01T08:30:00.000Z', '2026-12-01T09:30:00.000Z'), flight(12, 'GYE', 'UIO', '2026-12-01T10:00:00.000Z', '2026-12-01T11:00:00.000Z')];
    const result = await build(flights, [fare(1, 9_000), fare(11, 5_000), fare(12, 8_000)]).search.execute(legs);
    expect(result.offers.map((offer) => `${out(offer, 0)}+${out(offer, 1)}`)).toEqual(['FP1+FP12']);
  });

  it('C-10 / I: cada oferta queda guardada y resoluble por segmento para retenerla', async () => {
    const { search, store } = build(uioGye, uioFares);
    const result = await search.execute(oneWay);
    expect(store.saved.map((offer) => offer.offerId)).toEqual(result.offers.map((offer) => offer.offerId));
    await expect(search.resolveSegment({ segmentId: uuid(2) })).resolves.toMatchObject({ flightInstanceId: uuid(2) });
  });

  for (const limit of [1, 2]) {
    it(`F1-C-${limit} / I: solo ida devuelve las ${limit} mejores ofertas`, async () => {
      const result = await build(uioGye, uioFares, limit).search.execute(oneWay);
      expect(result.totalOffers).toBe(limit);
      expect(result.offers.map((offer) => out(offer))).toEqual(['FP3', 'FP1'].slice(0, limit));
    });
    it(`F1-R-${limit} / I: ida y vuelta devuelve las ${limit} mejores combinaciones`, async () => {
      const back = [flight(11, 'GYE', 'UIO', '2026-12-05T10:00:00.000Z', '2026-12-05T11:00:00.000Z'), flight(12, 'GYE', 'UIO', '2026-12-05T18:00:00.000Z', '2026-12-05T19:00:00.000Z')];
      const result = await build([...uioGye, ...back], [...uioFares, fare(11, 8_000), fare(12, 5_000)], limit).search.execute(roundTrip);
      expect(result.totalOffers).toBe(limit);
      expect(result.offers.map((offer) => `${out(offer, 0)}+${out(offer, 1)}`)).toEqual(['FP3+FP12', 'FP1+FP12'].slice(0, limit));
    });
    it(`F1-M-${limit} / I: multidestino mismo día conserva conexiones caras válidas con límite ${limit}`, async () => {
      const legs = { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01' }, { origin: 'GYE', destination: 'UIO', departureDate: '2026-12-01' }], passengers: mix };
      const flights = [flight(1, 'UIO', 'GYE', '2026-12-01T20:00:00.000Z', '2026-12-01T23:00:00.000Z'), flight(2, 'UIO', 'GYE', '2026-12-01T19:00:00.000Z', '2026-12-01T22:00:00.000Z'), flight(3, 'UIO', 'GYE', '2026-12-01T08:00:00.000Z', '2026-12-01T09:00:00.000Z'), flight(11, 'GYE', 'UIO', '2026-12-01T10:00:00.000Z', '2026-12-01T11:00:00.000Z'), flight(12, 'GYE', 'UIO', '2026-12-01T10:30:00.000Z', '2026-12-01T11:30:00.000Z')];
      const fares = [fare(1, 5_000), fare(2, 6_000), fare(3, 30_000), fare(11, 8_000), fare(12, 9_000)];
      const result = await build(flights, fares, limit).search.execute(legs);
      expect(result.totalOffers).toBe(limit);
      expect(result.offers.map((offer) => `${out(offer, 0)}+${out(offer, 1)}`)).toEqual(['FP3+FP11', 'FP3+FP12'].slice(0, limit));
    });
  }
});
