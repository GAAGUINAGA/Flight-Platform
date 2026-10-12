import { expect, it } from '@jest/globals';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';
import { GetSeatMapForOffer } from '../src/application/seat-map';

it('ANC-04 / I / K: GetSeatMapForOffer devuelve SeatMapResponse sin precios', async () => {
  const useCase = new GetSeatMapForOffer({ resolveSegment: async () => ({ segmentId: 'segment-1', flightInstanceId: 'flight-1', aircraft: 'E190' }), getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) }, { listByAircraft: async () => [{ cabinClass: 'ECONOMY', seatNumber: '1A', rowNumber: 1, characteristics: [] }, { cabinClass: 'ECONOMY', seatNumber: '1B', rowNumber: 1, characteristics: ['WINDOW'] }] }, { activeSeatNumbers: async () => ['1A'] });
  const map = await useCase.execute({ offerId: '00000000-0000-4000-8000-000000000001', segmentId: '00000000-0000-4000-8000-000000000002' });
  expect(map).toEqual({ segmentId: 'segment-1', cabins: [{ cabinClass: 'ECONOMY', rows: [{ rowNumber: 1, seats: [{ seatNumber: '1A', isAvailable: false, characteristics: [] }, { seatNumber: '1B', isAvailable: true, characteristics: ['WINDOW'] }] }] }] });
  const openapi = parse(readFileSync(join(process.cwd(), 'contracts/openapi/vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> } };
  const validate = new Ajv({ strict: false }).compile({ ...openapi.components.schemas.SeatMapResponse, components: openapi.components });
  expect(validate(map)).toBe(true);
  expect(JSON.stringify(map)).not.toMatch(/price/i);
});
