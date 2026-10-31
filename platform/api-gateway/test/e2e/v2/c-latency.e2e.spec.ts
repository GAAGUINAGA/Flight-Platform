import { randomInt, randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { expectV2Response } from './support';
import { startStack, type Scenario, type Stack } from './stack';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;
const FLIGHTS_PER_LEG = 12;
/** Booking espera la búsqueda en 5 s; la prueba exige un margen amplio (la medición real queda en la bitácora). */
const BUDGET_MS = 2_500;

describeReal('F12a-2 C · latencia de la búsqueda con varios vuelos por tramo', () => {
  let stack: Stack; let s: Scenario; const ids: string[] = []; const offerIds: string[] = [];
  beforeAll(async () => {
    stack = await startStack(); s = await stack.scenario();
    const make = async (reverse: boolean, index: number, day: number) => {
      const id = randomUUID(); ids.push(id); let flightNumber = '';
      for (let attempt = 0; attempt < 50; attempt += 1) { flightNumber = `FP${randomInt(1000, 10000)}`; if (await stack.db.inventory.flightInstance.count({ where: { flightNumber } }) === 0 && await stack.db.operations.operationalFlight.count({ where: { flightNumber } }) === 0) break; }
      const departure = new Date(s.departure.getTime() + day * 86_400_000 + index * 3_600_000 - 3_600_000 * FLIGHTS_PER_LEG); const arrival = new Date(departure.getTime() + 3_600_000);
      const [origin, destination] = reverse ? [s.destination, s.origin] : [s.origin, s.destination];
      await stack.db.inventory.flightInstance.create({ data: { id, flightNumber, departureIata: origin, arrivalIata: destination, departureAt: departure, arrivalAt: arrival, aircraft: s.aircraft, cabins: { create: [{ cabinClass: 'ECONOMY', sellable: 9 }, { cabinClass: 'BUSINESS', sellable: 4 }] } } });
      await stack.db.pricing.fare.createMany({ data: [{ cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: 8000 + index * 100 }, { cabinClass: 'ECONOMY', brand: 'FLEX', baseFareMinor: 12000 + index * 100 }, { cabinClass: 'BUSINESS', brand: 'FLEX', baseFareMinor: 30000 + index * 100 }].map((fare) => ({ flightInstanceId: id, ...fare, taxesMinor: 2000, rules: { changeable: true, refundable: true }, baggage: { checkedBags: 0 }, extraBagMinor: 5000 })) });
    };
    for (let index = 0; index < FLIGHTS_PER_LEG; index += 1) { await make(false, index, 0); await make(true, index, 7); }
  }, 180_000);
  afterAll(async () => {
    try {
      await s?.cleanup().catch(() => undefined);
      await stack?.db.pricing.offer.deleteMany({ where: { id: { in: offerIds } } }).catch(() => undefined);
      await stack?.db.pricing.fare.deleteMany({ where: { flightInstanceId: { in: ids } } }).catch(() => undefined);
      await stack?.db.inventory.flightInstance.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    } finally { await stack?.close(); }
  }, 120_000);

  it(`V2-C-08 / P: ida y vuelta con ${FLIGHTS_PER_LEG + 1} vuelos por tramo y 3 tarifas por vuelo responde dentro de ${BUDGET_MS} ms`, async () => {
    const returnDate = new Date(s.departure.getTime() + 7 * 86_400_000).toISOString().slice(0, 10); const times: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = Date.now();
      const res = await request(stack.server).post('/api/v2/vuelos/search').set('X-Device-Fingerprint', randomUUID()).send({ itineraries: [{ origin: s.origin, destination: s.destination, departureDate: s.date }, { origin: s.destination, destination: s.origin, departureDate: returnDate }], passengers: { adults: 2, children: 1 } });
      times.push(Date.now() - started);
      expect(res.status).toBe(200); if (attempt === 0) expectV2Response('POST', '/vuelos/search', 200, res.body);
      expect(res.body.totalOffers).toBe(10); offerIds.push(...res.body.offers.map((offer: { offerId: string }) => offer.offerId));
    }
    process.stdout.write(`LATENCIA búsqueda ida y vuelta (${FLIGHTS_PER_LEG} vuelos por tramo, 5 llamadas): ${times.join(' ms, ')} ms\n`);
    expect(Math.max(...times)).toBeLessThan(BUDGET_MS);
  }, 120_000);
});
