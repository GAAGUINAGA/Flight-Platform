import { expect, it } from '@jest/globals';
import { validConnection } from '../../src/domain/pricing';

it('PRC-05: tramos fuera de orden son rechazados', () => {
  expect(validConnection([
    { departureAt: new Date('2026-11-01T10:00:00Z'), arrivalAt: new Date('2026-11-01T11:00:00Z') },
    { departureAt: new Date('2026-11-01T10:30:00Z'), arrivalAt: new Date('2026-11-01T12:00:00Z') }
  ])).toBe(false);
});
