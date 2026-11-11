/* global __dirname */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import Ajv from 'ajv';
import type { Request, Response } from 'express';
import { parse } from 'yaml';
import type { GatewayConfig } from '../config';
import { asProblem } from '../web-errors';
import { openApiSpecPath } from '../openapi-path';

jest.mock('../grpc-clients', () => ({ callGatewayGrpc: jest.fn(), fetchSeatMap: jest.fn() }));
jest.mock('./events', () => ({ publishV2Event: jest.fn(async () => undefined) }));
import { callGatewayGrpc, fetchSeatMap } from '../grpc-clients';
import { V2HoldController } from './hold.controller';
import { V2ShoppingController } from './shopping.controller';
import { ShoppingController } from '../shopping.controller';

const SEG = '00000000-0000-4000-8000-0000000000a1'; const OTHER = '00000000-0000-4000-8000-0000000000a2'; const HOLD = '00000000-0000-4000-8000-0000000000b1';
const config = { v2: { publicBaseUrl: 'https://x.test' } } as unknown as GatewayConfig;
const req = { auth: { ownerId: 'owner-1' }, header: () => 'idem', res: { getHeader: () => 'corr' } } as unknown as Request;
const res = { status: jest.fn(), setHeader: jest.fn() } as unknown as Response;
const body = (extra: Record<string, unknown> = {}) => ({ offerId: '00000000-0000-4000-8000-0000000000c1', itinerarySelections: [{ itineraryId: '00000000-0000-4000-8000-0000000000d1', cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], passengersBreakdown: { adults: 2 }, ...extra });
const calls: string[] = [];
let ancillariesError: unknown;

beforeEach(() => {
  calls.length = 0; ancillariesError = undefined;
  jest.mocked(callGatewayGrpc).mockImplementation(async (_config, service, method) => {
    calls.push(`${service}.${method}`);
    if (method === 'holdOffer') return { holdId: HOLD, status: 'HELD', expiresAt: '2026-11-09T10:15:00Z', ttlMinutes: 15, lockedPrice: { currency: 'USD', total: '10.00' } };
    if (method === 'getOfferHold') return { status: 'HELD', itineraries: [{ segments: [{ segmentId: SEG }] }] };
    if (method === 'holdSeats' && ancillariesError) throw ancillariesError;
    return {};
  });
});

describe('HELD-GW: assignedSeats en POST /vuelos/offers/hold (acuerdo con Booking)', () => {
  it('HELD-GW-01: con asientos aparta tras crear el hold y responde 201 con la forma de siempre', async () => {
    const result = await new V2HoldController(config).create(req, res, body({ assignedSeats: [{ segmentId: SEG, seatNumber: '12A' }] }));
    expect(calls).toEqual(['pricing.holdOffer', 'pricing.getOfferHold', 'ancillaries.holdSeats']);
    expect(Object.keys(result).sort()).toEqual(['_links', 'expiresAt', 'holdId', 'lockedPrice', 'status', 'ttlMinutes']);
    expect(jest.mocked(callGatewayGrpc).mock.calls.find((call) => call[2] === 'holdSeats')?.[3]).toEqual({ holdId: HOLD, ownerId: 'owner-1', expiresAt: '2026-11-09T10:15:00Z', seats: [{ segmentId: SEG, seatNumber: '12A' }] });
  });
  it('HELD-GW-02: sin asientos (o vacío) no toca Ancillaries: el comportamiento de siempre', async () => {
    await new V2HoldController(config).create(req, res, body());
    await new V2HoldController(config).create(req, res, body({ assignedSeats: [] }));
    expect(calls.filter((call) => call.startsWith('ancillaries'))).toEqual([]);
  });
  it('HELD-GW-03: asiento ocupado: 409 SEAT_TAKEN y el hold recién creado se libera (no queda hold)', async () => {
    ancillariesError = Object.assign(new Error('x'), { code: 9, details: 'SEAT_TAKEN' });
    const error = await new V2HoldController(config).create(req, res, body({ assignedSeats: [{ segmentId: SEG, seatNumber: '12A' }] })).catch((thrown: unknown) => thrown);
    expect(asProblem(error)).toMatchObject({ status: 409, code: 'SEAT_TAKEN' });
    expect(calls).toEqual(['pricing.holdOffer', 'pricing.getOfferHold', 'ancillaries.holdSeats', 'pricing.releaseOfferHold']);
  });
  it.each([
    ['no es lista', 'x'], ['asiento mal formado', [{ segmentId: SEG, seatNumber: 'Z9' }]], ['segmento no uuid', [{ segmentId: 'SEG-1', seatNumber: '12A' }]],
    ['campo faltante', [{ segmentId: SEG }]], ['repetido', [{ segmentId: SEG, seatNumber: '12A' }, { segmentId: SEG, seatNumber: '12A' }]],
    ['segmento de otra oferta', [{ segmentId: OTHER, seatNumber: '12A' }]], ['más asientos que pasajeros', [{ segmentId: SEG, seatNumber: '12A' }, { segmentId: SEG, seatNumber: '12B' }, { segmentId: SEG, seatNumber: '12C' }]]
  ])('HELD-GW-04: %s → 422 sin dejar hold ni asientos', async (_name, assignedSeats) => {
    const error = await new V2HoldController(config).create(req, res, body({ assignedSeats })).catch((thrown: unknown) => thrown);
    expect(asProblem(error)).toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
    expect(calls).not.toContain('ancillaries.holdSeats');
    if (calls.includes('pricing.holdOffer')) expect(calls).toContain('pricing.releaseOfferHold');
  });
  it('HELD-GW-05: DELETE del hold libera también los asientos apartados (aunque el hold ya estuviera liberado)', async () => {
    jest.mocked(callGatewayGrpc).mockImplementation(async (_config, service, method) => { calls.push(`${service}.${method}`); return method === 'getOfferHold' ? { status: 'RELEASED' } : {}; });
    await new V2HoldController(config).release(req, HOLD);
    expect(calls).toEqual(['pricing.getOfferHold', 'ancillaries.releaseHeldSeats']);
  });
});

describe('HELD-MAP: estados del mapa (v1 y v2) contra los contratos', () => {
  const rawMap = { segmentId: SEG, cabins: [{ cabinClass: 'ECONOMY', rows: [{ rowNumber: 1, seats: [
    { seatNumber: '1A', isAvailable: true, characteristics: ['WINDOW'] }, { seatNumber: '1B', isAvailable: false, status: 'HELD', characteristics: [] }, { seatNumber: '1C', isAvailable: false, status: 'PROVISIONAL', characteristics: [] },
    { seatNumber: '1D', isAvailable: false, status: 'CONFIRMED', characteristics: [] }, { seatNumber: '1E', isAvailable: false, status: 'CHECKED_IN', characteristics: ['EMERGENCY_EXIT'] }
  ] }] }] };
  const schema = (path: string, name: string) => { const spec = parse(readFileSync(path, 'utf8')) as { components: { schemas: Record<string, object> } }; return new Ajv({ strict: false }).compile({ ...spec.components.schemas[name], components: spec.components }); };
  const seats = (map: unknown) => (map as typeof rawMap).cabins[0].rows[0].seats as Array<Record<string, unknown>>;
  beforeEach(() => { jest.mocked(fetchSeatMap).mockResolvedValue(JSON.parse(JSON.stringify(rawMap))); });

  it('HELD-MAP-01: v2 expone AVAILABLE, HELD, BOOKED, TICKETED y CHECKED_IN desde el estado de la asignación, e isAvailable false si no está libre', async () => {
    const map = await new V2ShoppingController(config).seatmap(req, '00000000-0000-4000-8000-0000000000c1', SEG);
    expect(seats(map).map((seat) => [seat.seatNumber, seat.status, seat.isAvailable])).toEqual([['1A', 'AVAILABLE', true], ['1B', 'HELD', false], ['1C', 'BOOKED', false], ['1D', 'TICKETED', false], ['1E', 'CHECKED_IN', false]]);
    expect(schema(join(__dirname, '..', '..', '..', '..', 'contracts/openapi/vuelos-openapi-v2.yaml'), 'SeatMapResponse')(map)).toBe(true);
  });
  it('HELD-MAP-02: v1 no cambia de forma: un asiento apartado es isAvailable false y no aparece `status`', async () => {
    const map = await new ShoppingController(config).seatmap(req, '00000000-0000-4000-8000-0000000000c1', SEG);
    expect(seats(map).every((seat) => !('status' in seat))).toBe(true);
    expect(seats(map).map((seat) => seat.isAvailable)).toEqual([true, false, false, false, false]);
    const validate = schema(openApiSpecPath(), 'SeatMapResponse'); expect(validate(map)).toBe(true);
  });
});
