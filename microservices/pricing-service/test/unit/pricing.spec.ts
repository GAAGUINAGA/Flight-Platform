import { calculateFare, validConnection, validateMix } from '../../src/domain/pricing';

describe('Pricing domain', () => {
  it('PRC-04: calcula total por tipo de pasajero y grandTotal en unidades menores', () => {
    expect(calculateFare(10_000, 2_000, { adults: 1, youths: 1, children: 1, infants: 1 })).toEqual({
      perType: { adults: { currency: 'USD', amountMinor: 12_000 }, youths: { currency: 'USD', amountMinor: 10_800 }, children: { currency: 'USD', amountMinor: 9_000 }, infants: { currency: 'USD', amountMinor: 1_200 } },
      total: { currency: 'USD', amountMinor: 33_000 }
    });
  });
  it('PRC-05: descarta conexión menor al MCT de 60 minutos', () => {
    expect(validConnection([{ departureAt: new Date('2026-11-01T10:00Z'), arrivalAt: new Date('2026-11-01T11:00Z') }, { departureAt: new Date('2026-11-01T11:59Z'), arrivalAt: new Date('2026-11-01T13:00Z') }])).toBe(false);
  });
  it('PRC-06: exige adulto, infantes no mayores que adultos y máximo nueve asientos', () => {
    expect(() => validateMix({ adults: 0, youths: 0, children: 1, infants: 0 })).toThrow('VALIDATION_FAILED');
    expect(() => validateMix({ adults: 1, youths: 8, children: 1, infants: 0 })).toThrow('VALIDATION_FAILED');
  });
});
