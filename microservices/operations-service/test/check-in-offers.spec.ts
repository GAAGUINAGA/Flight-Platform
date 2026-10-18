/* global __filename */
import { createRequire } from 'node:module';

type Segment = { segmentId: string; departure: { at: string } };
type Offer = { offerId: string; itineraries: Array<{ itineraryId: string; segments: Segment[]; pricingOptions: Array<{ cabinClass: string; fareBrand: string }> }> };
type Search = { offers: Offer[] };
type Request = { legs: Array<{ departureDate: string }> };
const { findCandidate } = createRequire(__filename)('../scripts/check-in-offers.cjs') as { findCandidate(search: (request: Request) => Promise<Search>, now: number): Promise<{ offer: Offer; segment: Segment; fare: { fareBrand: string } }> };
const now = Date.parse('2026-10-17T12:00:00.000Z');
const offer = (id: string, departure: string, fares = ['FLEX', 'BASIC']): Offer => ({ offerId: id, itineraries: [{ itineraryId: `it-${id}`, segments: [{ segmentId: `seg-${id}`, departure: { at: departure } }], pricingOptions: fares.map((fareBrand) => ({ cabinClass: 'ECONOMY', fareBrand })) }] });

describe('DCS-SMOKE: elección de vuelos del seed', () => {
  it('DCS-SMOKE-01: busca el día siguiente si la oferta anterior queda fuera de la ventana y selecciona la tarifa por propiedad', async () => {
    const search = jest.fn(async (request: Request): Promise<Search> => request.legs.some((leg) => leg.departureDate === '2026-10-19') ? { offers: [offer('fuera', '2026-10-19T12:00:00.000Z'), offer('válida', '2026-10-19T10:00:00.000Z')] } : { offers: [offer('temprana', '2026-10-17T13:00:00.000Z')] });
    const selected = await findCandidate(search, now);
    expect(selected).toMatchObject({ offer: { offerId: 'válida' }, segment: { segmentId: 'seg-válida' }, fare: { fareBrand: 'BASIC' } });
    expect(search.mock.calls.some(([request]) => request.legs.some((leg) => leg.departureDate === '2026-10-18'))).toBe(true);
    expect(search.mock.calls.some(([request]) => request.legs.some((leg) => leg.departureDate === '2026-10-19'))).toBe(true);
  });

  it('DCS-SMOKE-02: sin oferta dentro de la ventana informa NO_FLIGHT_IN_CHECKIN_WINDOW', async () => {
    const search = jest.fn(async (): Promise<Search> => ({ offers: [offer('lejos', '2026-10-20T12:00:00.000Z')] }));
    await expect(findCandidate(search, now)).rejects.toMatchObject({ code: 'NO_FLIGHT_IN_CHECKIN_WINDOW', details: 'NO_FLIGHT_IN_CHECKIN_WINDOW' });
    expect(search).toHaveBeenCalledTimes(12);
  });
});
