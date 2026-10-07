import { CabinCapacity } from '../../src/domain/cabin-capacity';
import { FlightInstance } from '../../src/domain/flight-instance';
import { InventoryHold, HoldStatus } from '../../src/domain/inventory-hold';
import { InventoryError } from '../../src/domain/errors';

const t0 = new Date('2026-10-10T10:00:00Z');
const later = new Date('2026-10-10T10:20:00Z');
const hold = (status: HoldStatus = 'HELD') =>
  new InventoryHold({
    id: 'h1', ownerId: 'u1', status, expiresAt: later, idempotencyKey: 'k',
    lines: [{ flightInstanceId: 'f1', cabinClass: 'ECONOMY', seats: 2 }]
  });
const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as InventoryError).code; }
  return undefined;
};

describe('CabinCapacity', () => {
  it('mantiene held + sold <= sellable', () => {
    const c = new CabinCapacity('ECONOMY', 3).hold(2);
    expect(c.available).toBe(1);
    expect(codeOf(() => c.hold(2))).toBe('OFFER_NO_LONGER_AVAILABLE');
    expect(c.consume(2)).toMatchObject({ held: 0, sold: 2, available: 1 });
    expect(codeOf(() => new CabinCapacity('ECONOMY', 2, 2, 1))).toBe('VALIDATION_FAILED');
  });
  it('no permite reducir sellable por debajo de lo comprometido', () => {
    expect(codeOf(() => new CabinCapacity('ECONOMY', 5, 2, 2).withSellable(3))).toBe('VALIDATION_FAILED');
  });
});

describe('FlightInstance', () => {
  const base = {
    id: 'f1', flightNumber: 'FP100', departureIata: 'UIO', arrivalIata: 'GYE',
    departureAt: later, arrivalAt: new Date(later.getTime() + 3600_000), closed: false,
    cabins: [new CabinCapacity('ECONOMY', 10)]
  };
  it('cerrada o ya salida no es vendible', () => {
    expect(new FlightInstance(base).isSellable(t0)).toBe(true);
    expect(new FlightInstance({ ...base, closed: true }).isSellable(t0)).toBe(false);
    expect(new FlightInstance(base).isSellable(later)).toBe(false);
  });
  it('rechaza llegada anterior a salida y cabinas repetidas', () => {
    expect(codeOf(() => new FlightInstance({ ...base, arrivalAt: t0 }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => new FlightInstance({ ...base, cabins: [base.cabins[0], base.cabins[0]] }))).toBe('VALIDATION_FAILED');
  });
});

describe('InventoryHold (BL ?14.2)', () => {
  it('HELD vencido se ve como EXPIRED aunque no corra el barrido', () => {
    expect(hold().effectiveStatus(t0)).toBe('HELD');
    expect(hold().effectiveStatus(later)).toBe('EXPIRED');
  });
  it('HELD ? CONSUMED con now < expiresAt; con now >= expiresAt falla', () => {
    const h = hold(); h.consume(t0);
    expect(h.status).toBe('CONSUMED');
    expect(codeOf(() => hold().consume(later))).toBe('OFFER_NO_LONGER_AVAILABLE');
  });
  it('HELD ? RELEASED restituye; repetir es idempotente', () => {
    const h = hold();
    expect(h.release(t0)).toBe(true);
    expect(h.status).toBe('RELEASED');
    expect(h.release(t0)).toBe(false);
  });
  it('liberar un HELD vencido lo marca EXPIRED', () => {
    const h = hold();
    expect(h.release(later)).toBe(true);
    expect(h.status).toBe('EXPIRED');
  });
  it('expire solo desde HELD vencido', () => {
    expect(codeOf(() => hold().expire(t0))).toBe('OFFER_NO_LONGER_AVAILABLE');
    const h = hold(); h.expire(later);
    expect(h.status).toBe('EXPIRED');
    expect(codeOf(() => h.expire(later))).toBe('OFFER_NO_LONGER_AVAILABLE');
  });
  it.each(['RELEASED', 'EXPIRED', 'CONSUMED'] as HoldStatus[])('%s es terminal para consume', (s) => {
    expect(codeOf(() => hold(s).consume(t0))).toBe('OFFER_NO_LONGER_AVAILABLE');
  });
  it('liberar un CONSUMED falla (GAP-011)', () => {
    expect(codeOf(() => hold('CONSUMED').release(t0))).toBe('OFFER_NO_LONGER_AVAILABLE');
  });
});
