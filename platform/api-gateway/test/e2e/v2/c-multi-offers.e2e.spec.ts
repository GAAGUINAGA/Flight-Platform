import { randomInt, randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { expectV2Response } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, headers } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
type Cabin = { cabinClass: 'ECONOMY' | 'BUSINESS'; sellable: number };
type Fare = { cabinClass: 'ECONOMY' | 'BUSINESS'; brand: string; baseFareMinor: number };
interface Offer { offerId: string; grandTotal: { total: string }; itineraries: Array<{ itineraryId: string; segments: Array<{ flightNumber: string; departure: { at: string } }>; pricingOptions: Array<{ cabinClass: string; fareBrand: string; availableSeats: number }> }> }
const flightsOf = (offer: Offer) => offer.itineraries.map((itinerary) => itinerary.segments[0].flightNumber);

describeReal('F12a-2 C · búsqueda con varias ofertas (contra servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = []; const extraFlights: string[] = []; const offerIds: string[] = [];
  const previousLimit = process.env.SEARCH_MAX_OFFERS;
  beforeAll(async () => { process.env.SEARCH_MAX_OFFERS = '4'; stack = await startStack(); }, 180_000);
  afterAll(async () => {
    try {
      for (const value of scenarios) await value.cleanup().catch(() => undefined);
      await stack?.db.pricing.offer.deleteMany({ where: { id: { in: offerIds } } }).catch(() => undefined);
      await stack?.db.pricing.fare.deleteMany({ where: { flightInstanceId: { in: extraFlights } } }).catch(() => undefined);
      await stack?.db.operations.operationalFlight.deleteMany({ where: { flightInstanceId: { in: extraFlights } } }).catch(() => undefined);
      await stack?.db.inventory.flightInstance.deleteMany({ where: { id: { in: extraFlights } } }).catch(() => undefined);
    } finally { await stack?.close(); if (previousLimit === undefined) delete process.env.SEARCH_MAX_OFFERS; else process.env.SEARCH_MAX_OFFERS = previousLimit; }
  }, 120_000);

  const scenario = async () => { const value = await stack.scenario(); scenarios.push(value); return value; };
  /** Otro vuelo de la ruta (o de la ruta inversa) con sus cabinas y tarifas; la prueba lo limpia en afterAll. */
  const addFlight = async (s: Scenario, options: { reverse?: boolean; departure: Date; cabins?: Cabin[]; fares: Fare[] }) => {
    const id = randomUUID(); let flightNumber = '';
    for (let attempt = 0; attempt < 50; attempt += 1) { flightNumber = `FP${randomInt(1000, 10000)}`; if (await stack.db.inventory.flightInstance.count({ where: { flightNumber } }) === 0 && await stack.db.operations.operationalFlight.count({ where: { flightNumber } }) === 0) break; }
    const origin = options.reverse ? s.destination : s.origin; const destination = options.reverse ? s.origin : s.destination; const arrival = new Date(options.departure.getTime() + 3_600_000);
    extraFlights.push(id);
    await stack.db.inventory.flightInstance.create({ data: { id, flightNumber, departureIata: origin, arrivalIata: destination, departureAt: options.departure, arrivalAt: arrival, aircraft: s.aircraft, cabins: { create: options.cabins ?? [{ cabinClass: 'ECONOMY', sellable: 5 }] } } });
    await stack.db.operations.operationalFlight.create({ data: { flightInstanceId: id, flightNumber, date: options.departure.toISOString().slice(0, 10), marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: origin, arrivalIata: destination, scheduledDepartureAt: options.departure, scheduledArrivalAt: arrival, aircraft: s.aircraft, status: 'SCHEDULED' } });
    for (const fare of options.fares) await stack.db.pricing.fare.create({ data: { flightInstanceId: id, cabinClass: fare.cabinClass, brand: fare.brand, baseFareMinor: fare.baseFareMinor, taxesMinor: 2000, rules: { changeable: true, refundable: true }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 } });
    return { id, flightNumber };
  };
  const search = async (itineraries: Array<{ origin: string; destination: string; departureDate: string }>, passengers: Record<string, number> = { adults: 1 }) => {
    const res = await request(stack.server).post('/api/v2/vuelos/search').set('X-Device-Fingerprint', randomUUID()).send({ itineraries, passengers });
    if (res.status === 200) offerIds.push(...(res.body.offers as Offer[]).map((offer) => offer.offerId));
    return res;
  };
  const route = (s: Scenario, date = s.date) => ({ origin: s.origin, destination: s.destination, departureDate: date });
  const back = (s: Scenario, date: string) => ({ origin: s.destination, destination: s.origin, departureDate: date });
  const holdOffer = async (s: Scenario, offer: Offer, choice: Array<{ cabinClass: string; fareBrand: string }>, user: string) => {
    const response = await request(stack.server).post('/api/v2/vuelos/offers/hold').set(await headers(stack, s.client, user)).set('Idempotency-Key', randomUUID())
      .send({ offerId: offer.offerId, itinerarySelections: offer.itineraries.map((itinerary, index) => ({ itineraryId: itinerary.itineraryId, ...choice[index] })), passengersBreakdown: { adults: 1 } });
    expect({ status: response.status, body: response.status === 201 ? 'ok' : response.body }).toEqual({ status: 201, body: 'ok' });
    return { holdId: response.body.holdId as string, lockedPrice: response.body.lockedPrice as { currency: string; total: string }, offer: undefined as never };
  };

  it('V2-C-01 / I: varios vuelos del tramo ⇒ una oferta por vuelo, de la más barata a la más cara, y cumple SearchResponse', async () => {
    const s = await scenario(); const date = new Date(s.departure);
    const cheap = await addFlight(s, { departure: new Date(date.getTime() - 3 * 3_600_000), fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 8000 }] });
    const res = await search([route(s)]);
    expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/search', 200, res.body);
    const offers = (res.body.offers as Offer[]).map((offer) => ({ flights: flightsOf(offer), total: offer.grandTotal.total }));
    expect(offers).toEqual([{ flights: [cheap.flightNumber], total: '100.00' }, { flights: [s.flightNumber], total: '120.00' }]);
    expect(res.body.totalOffers).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain('flightInstanceId');
  }, 90_000);

  it('V2-C-02 / I: el vuelo sin capacidad para los pasajeros pedidos queda excluido y el que sí cabe se ofrece', async () => {
    const s = await scenario(); const small = await addFlight(s, { departure: new Date(s.departure.getTime() + 2 * 3_600_000), cabins: [{ cabinClass: 'ECONOMY', sellable: 1 }], fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 5000 }] });
    const two = await search([route(s)], { adults: 2 });
    expect(two.status).toBe(200);
    expect((two.body.offers as Offer[]).flatMap(flightsOf)).toEqual([s.flightNumber]);
    const one = await search([route(s)], { adults: 1 });
    expect((one.body.offers as Offer[]).flatMap(flightsOf)).toEqual([small.flightNumber, s.flightNumber]);
  }, 90_000);

  it('V2-C-03 / I: un vuelo sin tarifa no se ofrece', async () => {
    const s = await scenario(); await addFlight(s, { departure: new Date(s.departure.getTime() + 3_600_000), fares: [] });
    const res = await search([route(s)]);
    expect((res.body.offers as Offer[]).flatMap(flightsOf)).toEqual([s.flightNumber]);
  }, 90_000);

  it('V2-C-04 / I: un tramo sin vuelos devuelve cero ofertas en ida y vuelta', async () => {
    const s = await scenario();
    const res = await search([route(s), back(s, new Date(s.departure.getTime() + 7 * 86_400_000).toISOString().slice(0, 10))]);
    expect(res.status).toBe(200); expect(res.body).toEqual({ totalOffers: 0, offers: [] });
  }, 90_000);

  it('V2-C-05 / I: ida y vuelta combina los vuelos, ordena por precio total y respeta el límite configurado', async () => {
    const s = await scenario(); const returnDate = new Date(s.departure.getTime() + 7 * 86_400_000);
    const cheapOut = await addFlight(s, { departure: new Date(s.departure.getTime() - 3 * 3_600_000), fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 8000 }] });
    const r1 = await addFlight(s, { reverse: true, departure: returnDate, fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 9000 }] });
    const r2 = await addFlight(s, { reverse: true, departure: new Date(returnDate.getTime() + 4 * 3_600_000), fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 6000 }] });
    const res = await search([route(s), back(s, returnDate.toISOString().slice(0, 10))]);
    expect(res.status).toBe(200); expectV2Response('POST', '/vuelos/search', 200, res.body);
    // 2 ida × 2 vuelta = 4 combinaciones; el límite de la prueba es 4.
    expect((res.body.offers as Offer[]).map((offer) => `${flightsOf(offer).join('+')}=${offer.grandTotal.total}`)).toEqual([
      `${cheapOut.flightNumber}+${r2.flightNumber}=180.00`, `${s.flightNumber}+${r2.flightNumber}=200.00`, `${cheapOut.flightNumber}+${r1.flightNumber}=210.00`, `${s.flightNumber}+${r1.flightNumber}=230.00`
    ]);
    const third = await addFlight(s, { departure: new Date(s.departure.getTime() + 5 * 3_600_000), fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 20000 }] });
    const limited = await search([route(s), back(s, returnDate.toISOString().slice(0, 10))]);
    expect(limited.body.totalOffers).toBe(4);
    expect((limited.body.offers as Offer[]).flatMap(flightsOf)).not.toContain(third.flightNumber);
  }, 120_000);

  it('V2-C-06 / I: cada oferta (no solo la primera) se puede retener y reservar, también con otra cabina y marca', async () => {
    const s = await scenario();
    const multi = await addFlight(s, { departure: new Date(s.departure.getTime() - 3 * 3_600_000), cabins: [{ cabinClass: 'ECONOMY', sellable: 5 }, { cabinClass: 'BUSINESS', sellable: 2 }], fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 8000 }, { cabinClass: 'BUSINESS', brand: 'FLEX', baseFareMinor: 30000 }] });
    const res = await search([route(s)]); const offers = res.body.offers as Offer[];
    expect(offers.map((offer) => flightsOf(offer)[0])).toEqual([multi.flightNumber, s.flightNumber]);
    expect(offers[0].itineraries[0].pricingOptions.map((option) => [option.cabinClass, option.fareBrand])).toEqual([['ECONOMY', 'BASIC'], ['BUSINESS', 'FLEX']]);
    const business = await holdOffer(s, offers[0], [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX' }], 'user-business');
    const first = await book(stack, s, s.client, 'user-business', business as never);
    expect({ status: first.response.status, state: first.response.body.status }).toEqual({ status: 201, state: 'CONFIRMED' });
    const other = await holdOffer(s, offers[1], [{ cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }], 'user-classic');
    const second = await book(stack, s, s.client, 'user-classic', other as never);
    expect({ status: second.response.status, state: second.response.body.status }).toEqual({ status: 201, state: 'CONFIRMED' });
  }, 150_000);

  it('V2-C-07 / I: una oferta de ida y vuelta se retiene y se reserva completa', async () => {
    const s = await scenario(); const returnDate = new Date(s.departure.getTime() + 7 * 86_400_000);
    const r1 = await addFlight(s, { reverse: true, departure: returnDate, fares: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 9000 }] });
    const res = await search([route(s), back(s, returnDate.toISOString().slice(0, 10))]); const offers = res.body.offers as Offer[];
    expect(offers).toHaveLength(1); expect(flightsOf(offers[0])).toEqual([s.flightNumber, r1.flightNumber]);
    const held = await holdOffer(s, offers[0], [{ cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }, { cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], 'user-round');
    const booked = await book(stack, s, s.client, 'user-round', held as never);
    expect({ status: booked.response.status, state: booked.response.body.status }).toEqual({ status: 201, state: 'CONFIRMED' });
    expect(booked.response.body.tickets.length).toBeGreaterThan(0);
  }, 150_000);
});
