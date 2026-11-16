import { describe, expect, it } from '@jest/globals';
import { cabinsAllHaveFares, cabinsMissingFares, DEFAULT_FLIGHT_RULES, faresMatch, flightIdFromKey, planFlight, uuidV5, type PlannedFare } from './admin-flights';

/** F12c-4c: reglas P6 puras (sin servicios). */
const NOW = new Date('2026-11-15T12:00:00Z');
const CATALOG = [{ code: 'E190', cabins: [{ cabinClass: 'ECONOMY', seats: 99 }] }, { code: 'B787', cabins: [{ cabinClass: 'BUSINESS', seats: 30 }, { cabinClass: 'ECONOMY', seats: 200 }] }];
const fare = (cabinClass: string, fareBrand: string) => ({ cabinClass, fareBrand, baseFare: '80.00', taxes: '20.00', isRefundable: false, isChangeable: true, carryOnIncluded: 1, checkedBaggageIncluded: 0, extraBaggagePrice: '35.00' });
const body = (extra: Record<string, unknown> = {}) => ({ flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureLocal: '2026-11-20T15:00', durationMinutes: 120, aircraft: 'E190', fares: [fare('ECONOMY', 'Basic')], ...extra });

describe('F12c-4c: planFlight (ADM4-F-U)', () => {
  it('ADM4-F-U-01: convierte la hora local del ORIGEN a UTC y calcula la llegada en la hora local del DESTINO; el total es base + tasas', () => {
    const result = planFlight(body(), DEFAULT_FLIGHT_RULES, CATALOG, NOW);
    if (!('plan' in result)) throw new Error(JSON.stringify(result));
    expect(result.plan.departureAt.toISOString()).toBe('2026-11-20T20:00:00.000Z'); expect(result.plan.arrivalAt.toISOString()).toBe('2026-11-20T22:00:00.000Z');
    expect(result.plan.departureLocal).toBe('2026-11-20T15:00'); expect(result.plan.arrivalLocal).toBe('2026-11-20T16:00');
    expect(result.plan.fares[0].total).toBe('100.00'); expect(result.plan.cabins).toEqual([{ cabinClass: 'ECONOMY', capacity: 99 }]);
  });
  it('ADM4-F-U-02: vuelo largo entre zonas con horario de verano (MAD→UIO, B787): la llegada local usa la zona del destino', () => {
    const result = planFlight(body({ origin: 'MAD', destination: 'UIO', departureLocal: '2026-12-01T12:00', durationMinutes: 780, aircraft: 'B787', fares: [fare('BUSINESS', 'Premium'), fare('ECONOMY', 'Basic')] }), DEFAULT_FLIGHT_RULES, CATALOG, NOW);
    if (!('plan' in result)) throw new Error(JSON.stringify(result));
    expect(result.plan.departureAt.toISOString()).toBe('2026-12-01T11:00:00.000Z'); expect(result.plan.arrivalLocal).toBe('2026-12-01T19:00');
  });
  it('ADM4-F-U-03: los errores nombran campos y razones, nunca valores', () => {
    const result = planFlight(body({ flightNumber: 'AA210', destination: 'ZZZ', aircraft: 'X999', durationMinutes: 5 }), DEFAULT_FLIGHT_RULES, CATALOG, NOW);
    if (!('errors' in result)) throw new Error('debió fallar');
    expect(result.errors).toEqual(expect.arrayContaining([{ name: 'flightNumber', reason: 'airline-prefix' }, { name: 'destination', reason: 'airport-unknown' }, { name: 'aircraft', reason: 'aircraft-not-supported' }, { name: 'durationMinutes', reason: 'duration-out-of-range' }]));
    expect(JSON.stringify(result.errors)).not.toMatch(/AA210|ZZZ|X999/);
  });
  it('ADM4-F-U-04: los límites son variables de entorno, no constantes: el prefijo, la anticipación y la duración salen de las reglas', () => {
    const rules = { ...DEFAULT_FLIGHT_RULES, airlinePrefix: 'GB', minLeadMinutes: 10_000, maxDurationMinutes: 60 };
    const result = planFlight(body({ flightNumber: 'GB1' }), rules, CATALOG, NOW);
    if (!('errors' in result)) throw new Error('debió fallar');
    expect(result.errors).toEqual(expect.arrayContaining([{ name: 'departureLocal', reason: 'too-soon' }, { name: 'durationMinutes', reason: 'duration-out-of-range' }])); expect(result.errors).not.toContainEqual({ name: 'flightNumber', reason: 'airline-prefix' });
  });
  it('ADM4-F-U-05: el id de la instancia sale de la Idempotency-Key (UUIDv5 estable) y depende del administrador', () => {
    const key = '8f1b0b8e-6c4e-4a52-9a8e-0b6f2c1d3e4f';
    expect(flightIdFromKey('admin-1', key)).toBe(flightIdFromKey('admin-1', key.toUpperCase())); expect(flightIdFromKey('admin-1', key)).not.toBe(flightIdFromKey('admin-2', key));
    expect(flightIdFromKey('admin-1', key)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV5('x')).toBe(uuidV5('x')); expect(uuidV5('x')).not.toBe(uuidV5('y'));
  });
  it('ADM4-F-U-06: faresMatch y cabinsAllHaveFares comparan lo RELEÍDO, campo por campo', () => {
    const planned = planFlight(body(), DEFAULT_FLIGHT_RULES, CATALOG, NOW); if (!('plan' in planned)) throw new Error('plan');
    const expected: PlannedFare[] = planned.plan.fares;
    const stored = [{ cabinClass: 'ECONOMY', fareBrand: 'Basic', price: { currency: 'USD', total: '100.00', baseFare: '80.00', taxes: '20.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { total: '35.00' } }];
    expect(faresMatch(expected, stored)).toBe(true);
    expect(faresMatch(expected, [{ ...stored[0], price: { ...stored[0].price, total: '99.99' } }])).toBe(false);
    expect(faresMatch(expected, [{ ...stored[0], extraCheckedBaggagePrice: { total: '36.00' } }])).toBe(false);
    expect(faresMatch(expected, [])).toBe(false);
    expect(cabinsAllHaveFares(planned.plan.cabins, stored)).toBe(true); expect(cabinsAllHaveFares(planned.plan.cabins, [])).toBe(false);
    expect(cabinsAllHaveFares([{ cabinClass: 'ECONOMY', capacity: 99 }, { cabinClass: 'BUSINESS', capacity: 12 }], stored)).toBe(false);
  });
  it('ADM4-F-U-07: comprobación única de apertura — todas las cabinas con tarifa válida ⇒ vacío; falta una ⇒ la nombra; una tarifa inválida no cuenta', () => {
    const good = { cabinClass: 'ECONOMY', fareBrand: 'Basic', price: { currency: 'USD', total: '100.00', baseFare: '80.00', taxes: '20.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { total: '35.00' } };
    const both = [{ cabinClass: 'BUSINESS', capacity: 12 }, { cabinClass: 'ECONOMY', capacity: 150 }];
    expect(cabinsMissingFares(both, [good, { ...good, cabinClass: 'BUSINESS' }])).toEqual([]);
    expect(cabinsMissingFares(both, [good])).toEqual(['BUSINESS']);
    expect(cabinsMissingFares(both, [])).toEqual(['BUSINESS', 'ECONOMY']);
    expect(cabinsMissingFares([{ cabinClass: 'FIRST', capacity: 0 }], [])).toEqual([]); // sin asientos no exige tarifa
    const bad: Array<Record<string, unknown>> = [
      { price: { ...good.price, total: '99.00' } }, { price: { ...good.price, currency: 'EUR' } }, { price: { ...good.price, currency: undefined } },
      { price: { currency: 'USD', total: '0.00', baseFare: '0.00', taxes: '0.00' } }, { fareRules: undefined }, { baggageAllowance: { carryOnIncluded: 1 } }, { extraCheckedBaggagePrice: {} }, { fareBrand: '' }
    ];
    for (const change of bad) expect(cabinsMissingFares([{ cabinClass: 'ECONOMY', capacity: 150 }], [{ ...good, ...change }])).toEqual(['ECONOMY']);
  });
});
