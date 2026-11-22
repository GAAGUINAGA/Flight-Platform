import { afterEach, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { CreateReservation } from '../src/application/create-reservation';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

/** audit-49 H1 (REGLA 3, ADR-fixCompra-01 decisión 7): la referencia de pago YA USADA al guardar. Una prueba por caso. */
const passenger = { passengerId: '00000000-0000-4000-8000-000000000002', passengerType: 'ADULT', birthDate: '1990-01-01' };
const itineraryId = '00000000-0000-4000-8000-000000000003'; const segmentId = '00000000-0000-4000-8000-000000000004';
const input = { ownerId: 'owner', holdId: 'hold', passengers: [passenger], payment: { paymentReference: 'pay_ok_rf3' }, idempotencyKey: 'key-rf3' };
const build = () => {
  const pricing = new FakePricingPort(); const ancillaries = new FakeAncillariesPort(); const payment = new FakePaymentVerifier();
  pricing.holds.set('hold', { holdId: 'hold', ownerId: 'owner', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '420.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId, segments: [{ segmentId }], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', baggageAllowance: { checkedBaggageIncluded: 2 } }] }] });
  const trail: string[] = []; const released: string[] = [];
  const originalVerify = payment.verify.bind(payment); payment.verify = async (value) => { trail.push('payment.verify'); return originalVerify(value); };
  const originalVoid = payment.void.bind(payment); payment.void = async (value) => { trail.push('payment.void'); return originalVoid(value); };
  pricing.releaseHold = async () => { released.push('hold'); }; ancillaries.releaseHeldSeats = async () => { released.push('seats'); };
  const store = new InMemoryReservationStore();
  const service = new CreateReservation(store, pricing, payment, ancillaries, new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher());
  const boom = new Error('fallo al guardar');
  const saved = (overrides: Record<string, unknown>) => ({ id: 'x', ownerId: 'owner', idempotencyKey: 'key-rf3', status: 'PENDING', changes: [] as unknown[], ...overrides });
  /** La primera consulta (validación previa) ve la referencia libre; las siguientes (tras el fallo) devuelven `after`. */
  const lookups = (after: () => unknown) => { let calls = 0; store.findByPaymentReference = async () => (++calls === 1 ? undefined : after() as never); };
  return { service, store, trail, released, boom, saved, lookups };
};
afterEach(() => jest.restoreAllMocks());

it('RF3-1: store.create falla y NADIE tiene la referencia ⇒ pago anulado y error original', async () => {
  const { service, store, trail, released, boom } = build();
  store.create = async () => { throw boom; };
  await expect(service.execute(input)).rejects.toBe(boom);
  expect(trail).toEqual(['payment.verify', 'payment.void']); expect(released).toEqual([]);
});

it('RF3-2a: la reserva hallada tiene NUESTRO id ⇒ queda FAILED con historial, pago anulado, hold y asientos liberados, error original', async () => {
  const { service, store, trail, released, boom, saved, lookups } = build();
  let found: unknown; let updated: unknown;
  store.create = async (reservation) => { found = saved({ id: reservation.id, ownerId: 'otro', idempotencyKey: 'otra' }); throw boom; };
  lookups(() => found); store.update = async (value) => { updated = value; };
  await expect(service.execute(input)).rejects.toBe(boom);
  expect(updated).toMatchObject({ status: 'FAILED', changes: [{ description: 'FAILED' }] });
  expect(trail).toEqual(['payment.verify', 'payment.void']); expect(released).toEqual(['hold', 'seats']);
});

it('RF3-2b: la hallada es del MISMO dueño y la MISMA clave ⇒ igual que 2a', async () => {
  const { service, store, trail, released, boom, saved, lookups } = build();
  let updated: unknown;
  store.create = async () => { throw boom; };
  lookups(() => saved({ id: 'otro-id' })); store.update = async (value) => { updated = value; };
  await expect(service.execute(input)).rejects.toBe(boom);
  expect(updated).toMatchObject({ status: 'FAILED', changes: [{ description: 'FAILED' }] });
  expect(trail).toEqual(['payment.verify', 'payment.void']); expect(released).toEqual(['hold', 'seats']);
});

it('RF3-3: la hallada es de otro dueño u otra clave ⇒ NO se anula, no se toca, error original', async () => {
  for (const other of [{ ownerId: 'otro-dueno' }, { idempotencyKey: 'otra-clave' }]) {
    const { service, store, trail, released, boom, saved, lookups } = build();
    let updated = false;
    store.create = async () => { throw boom; };
    lookups(() => saved({ id: 'otro-id', ...other })); store.update = async () => { updated = true; };
    await expect(service.execute(input)).rejects.toBe(boom);
    expect(trail).toEqual(['payment.verify']); expect(released).toEqual([]); expect(updated).toBe(false);
  }
});

it('RF3-4: la búsqueda misma falla ⇒ se anula el pago y se registra; error original', async () => {
  const { service, store, trail, boom, lookups } = build();
  const logged: string[] = []; jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => { logged.push(String(message)); });
  store.create = async () => { throw boom; };
  lookups(() => { throw new Error('base caída'); });
  await expect(service.execute(input)).rejects.toBe(boom);
  expect(trail).toEqual(['payment.verify', 'payment.void']);
  expect(logged.some((line) => line.includes('compensation step=store.findByPaymentReference failed'))).toBe(true);
  expect(logged.join('\n')).not.toMatch(/pay_ok_rf3|base caída/);
});
