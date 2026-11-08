import { describe, expect, it } from '@jest/globals';
import { FakeInventoryGateway } from '../../src/infrastructure/inventory/fake-inventory.gateway';
import type { AvailableFlight } from '../../src/application/ports';

// LD-T5: el falso reproduce la regla real de Inventory (NFR-TI-01): departureDate es la fecha local del origen.
const flight = (origin: string, at: string) => ({ segment: { departure: { iataCode: origin, at }, arrival: { iataCode: 'MAD', at } } }) as unknown as AvailableFlight;

describe('FakeInventoryGateway · fecha local', () => {
  const gateway = new FakeInventoryGateway([flight('LIM', '2030-06-11T03:30:00.000Z'), flight('UIO', '2030-06-11T00:00:00.000Z'), flight('QQQ', '2030-06-11T03:30:00.000Z')]);
  const search = async (origin: string, departureDate: string) => (await gateway.queryAvailability({ origin, destination: 'MAD', departureDate })).length;

  it('LIM 22:30 locales y UIO 19:00 locales se encuentran en su fecha local y no en la UTC', async () => {
    expect(await search('LIM', '2030-06-10')).toBe(1);
    expect(await search('LIM', '2030-06-11')).toBe(0);
    expect(await search('UIO', '2030-06-10')).toBe(1);
    expect(await search('UIO', '2030-06-11')).toBe(0);
  });

  it('un origen sin zona se lee en UTC', async () => {
    expect(await search('QQQ', '2030-06-11')).toBe(1);
    expect(await search('QQQ', '2030-06-10')).toBe(0);
  });
});
