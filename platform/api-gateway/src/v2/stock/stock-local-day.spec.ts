import { describe, expect, it, jest } from '@jest/globals';
import { loadConfig } from '../../config';
import { callGatewayGrpc } from '../../grpc-clients';
import { InMemoryStockOutbox } from './outbox';
import { StockSync } from './stock-sync';

jest.mock('../../grpc-clients', () => ({ callGatewayGrpc: jest.fn() }));

// NFR-TI-01 / ADR-F12b1fix-02 (LD-10): el stock usa la fecha local del origen, también para BOG/LIM/MIA/MAD.
const base = { NODE_ENV: 'test', INTERNAL_API_KEY: 'k'.repeat(24), PUBLIC_BASE_URL: 'http://gateway.test', JWT_ISSUERS: JSON.stringify([{ iss: 'u', aud: 'a', jwksUri: 'http://127.0.0.1:9/j' }]) };

describe('LD-10 stock con fecha local', () => {
  it.each([
    ['LIM', 'MAD', '2030-06-11T03:30:00.000Z', '2030-06-10', '22:30'],
    ['UIO', 'GYE', '2030-06-11T00:00:00.000Z', '2030-06-10', '19:00'],
    ['BOG', 'MIA', '2030-06-11T04:59:00.000Z', '2030-06-10', '23:59'],
    ['MAD', 'LIM', '2030-06-09T22:05:00.000Z', '2030-06-10', '00:05'],
    ['QQQ', 'RRR', '2030-06-11T03:30:00.000Z', '2030-06-11', '03:30']
  ])('%s→%s: consulta la disponibilidad con la fecha local y envía date/time_slot locales', async (origin, destination, at, date, time) => {
    const calls: Array<{ method: string; request: Record<string, unknown> }> = [];
    (callGatewayGrpc as unknown as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockImplementation(async (...args: unknown[]) => {
      const method = args[2] as string; const request = args[3] as Record<string, unknown>; calls.push({ method, request });
      if (method === 'getFlightInstance') return { closed: false, segment: { flightNumber: 'FP500', departure: { iataCode: origin, at }, arrival: { iataCode: destination } }, cabins: [{ cabinClass: 'ECONOMY' }] };
      return { flights: [{ segment: { flightNumber: 'FP500' }, cabinClass: 'ECONOMY', availableSeats: 7 }] };
    });
    const sync = new StockSync(loadConfig(base), new InMemoryStockOutbox(), { push: async () => undefined });
    const updates = await sync.snapshot('11111111-1111-4111-8111-111111111111', 'c');
    expect(calls.find((call) => call.method === 'queryAvailability')?.request).toMatchObject({ origin, destination, departureDate: date });
    expect(updates).toEqual([expect.objectContaining({ item_id: 'FP500-ECONOMY', date, time_slot: time, available_units: 7 })]);
  });
});
