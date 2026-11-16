import { describe, expect, it } from 'vitest';
import { arrivalLocalOf, copyFares, draftSignature, emptyDraft, faresFor, normalizeAmount, parseFactor, reasonText, toCreateInput, totalOf, validateDraft, type Aircraft, type FlightDraft, type StoredFare } from './flight-create-rules';

const NOW = new Date('2026-11-15T12:00:00Z');
const A320: Aircraft = { code: 'A320', cabins: [{ cabinClass: 'BUSINESS', seats: 12 }, { cabinClass: 'ECONOMY', seats: 150 }] };
const valid = (patch: Partial<FlightDraft> = {}): FlightDraft => ({ ...emptyDraft(), digits: '210', origin: 'UIO', destination: 'GPS', departureLocal: '2026-11-20T15:00', durationMinutes: '120', aircraft: 'A320',
  fares: faresFor(A320).map((fare) => ({ ...fare, baseFare: '80', taxes: '20.5', extraBaggagePrice: '35' })), ...patch });

describe('crear vuelo: reglas del formulario (ADM4-F-W)', () => {
  it('ADM4-F-W-01 un borrador válido no tiene errores; el número es FP + dígitos; los importes se normalizan a dos decimales y el total es base + tasas', () => {
    expect(validateDraft(valid(), A320, NOW)).toEqual({});
    const input = toCreateInput(valid()); expect(input).toMatchObject({ flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureLocal: '2026-11-20T15:00', durationMinutes: 120, aircraft: 'A320', openForSale: true });
    expect(input.fares[0]).toMatchObject({ baseFare: '80.00', taxes: '20.50', extraBaggagePrice: '35.00' }); expect(totalOf({ baseFare: '80', taxes: '20,5' })).toBe('100.50');
    expect(normalizeAmount('12')).toBe('12.00'); expect(normalizeAmount('12,5')).toBe('12.50'); expect(normalizeAmount('12.345')).toBeNull(); expect(normalizeAmount('-1')).toBeNull(); expect(normalizeAmount('')).toBeNull();
  });
  it('ADM4-F-W-02 la llegada se calcula en la hora LOCAL del destino (UIO UTC-5 → GPS UTC-6)', () => {
    expect(arrivalLocalOf(valid())).toBe('2026-11-20T16:00'); expect(arrivalLocalOf(valid({ durationMinutes: '' }))).toBeNull(); expect(arrivalLocalOf(valid({ destination: '' }))).toBeNull();
  });
  it.each([
    ['dígitos', { digits: '' }, 'digits'], ['dígitos de más', { digits: '12345' }, 'digits'], ['origen', { origin: '' }, 'origin'], ['destino igual al origen', { destination: 'UIO' }, 'destination'],
    ['duración corta', { durationMinutes: '19' }, 'durationMinutes'], ['duración larga', { durationMinutes: '1201' }, 'durationMinutes'], ['salida demasiado pronto', { departureLocal: '2026-11-15T07:30' }, 'departureLocal'],
    ['salida lejana', { departureLocal: '2028-12-20T15:00' }, 'departureLocal'], ['fecha inexistente', { departureLocal: '2026-02-30T10:00' }, 'departureLocal'], ['sin avión', { aircraft: '' }, 'aircraft']
  ])('ADM4-F-W-03 %s ⇒ error en el campo', (_name, patch, field) => { expect(Object.keys(validateDraft(valid(patch as Partial<FlightDraft>), (patch as { aircraft?: string }).aircraft === '' ? undefined : A320, NOW))).toContain(field); });
  it('ADM4-F-W-04 una cabina sin tarifa, más de 4 marcas, marca repetida e importes inválidos se señalan', () => {
    const draft = valid(); const noBusiness = { ...draft, fares: draft.fares.filter((fare) => fare.cabinClass !== 'BUSINESS') };
    expect(validateDraft(noBusiness, A320, NOW)['cabin.BUSINESS']).toMatch(/Falta/);
    const many = { ...draft, fares: [...draft.fares, ...[1, 2, 3, 4].map((n) => ({ ...draft.fares[1], fareBrand: `M${n}` }))] }; expect(validateDraft(many, A320, NOW)['cabin.ECONOMY']).toMatch(/Máximo 4/);
    const repeated = { ...draft, fares: [...draft.fares, { ...draft.fares[1], fareBrand: ' BASIC ' }] }; expect(Object.values(validateDraft(repeated, A320, NOW)).join(' ')).toMatch(/ya existe/);
    const bad = { ...draft, fares: draft.fares.map((fare) => ({ ...fare, baseFare: 'abc', taxes: '-1', extraBaggagePrice: '', carryOnIncluded: '12' })) }; const errors = validateDraft(bad, A320, NOW);
    expect(errors['fares.0.baseFare']).toBeDefined(); expect(errors['fares.0.taxes']).toBeDefined(); expect(errors['fares.0.extraBaggagePrice']).toBeDefined(); expect(errors['fares.0.carryOnIncluded']).toBeDefined();
    expect(validateDraft({ ...draft, fares: draft.fares.map((fare) => ({ ...fare, baseFare: '0', taxes: '0' })) }, A320, NOW)['fares.0.baseFare']).toMatch(/mayor que cero/);
  });
  it('ADM4-F-W-05 la firma de la intención cambia con cualquier dato (otra Idempotency-Key) y no con lo que no se envía', () => {
    expect(draftSignature(valid())).toBe(draftSignature(valid())); expect(draftSignature(valid({ durationMinutes: '121' }))).not.toBe(draftSignature(valid()));
    expect(draftSignature(valid({ leaveClosed: true }))).not.toBe(draftSignature(valid())); expect(toCreateInput(valid({ leaveClosed: true })).openForSale).toBe(false);
  });
  it('ADM4-F-W-06 copiar tarifas de otro vuelo con un factor (redondeo al centavo, solo cabinas del avión elegido)', () => {
    const stored: StoredFare[] = [
      { cabinClass: 'ECONOMY', fareBrand: 'Basic', price: { baseFare: '80.00', taxes: '20.00', total: '100.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { total: '35.00' } },
      { cabinClass: 'FIRST', fareBrand: 'Lujo', price: { baseFare: '900.00', taxes: '90.00', total: '990.00' }, fareRules: { isRefundable: true, isChangeable: true }, baggageAllowance: { carryOnIncluded: 2, checkedBaggageIncluded: 2 }, extraCheckedBaggagePrice: { total: '50.00' } }
    ];
    const rows = copyFares(stored, A320, 1.1); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cabinClass: 'ECONOMY', fareBrand: 'Basic', baseFare: '88.00', taxes: '22.00', extraBaggagePrice: '38.50', isRefundable: false, isChangeable: true, carryOnIncluded: '1', checkedBaggageIncluded: '0' });
    expect(parseFactor('1,10')).toBe(1.1); for (const bad of ['', '0', '-1', 'x', '11']) expect(parseFactor(bad)).toBeNull();
  });
  it('ADM4-F-W-07 los motivos del Gateway se muestran en español sin valores', () => {
    expect(reasonText('local-time-nonexistent')).toMatch(/no existe/); expect(reasonText('local-time-ambiguous')).toMatch(/se repite/); expect(reasonText('missing-fare-BUSINESS')).toMatch(/BUSINESS/); expect(reasonText('algo-raro')).toBe('Revisa este campo.');
  });
});
