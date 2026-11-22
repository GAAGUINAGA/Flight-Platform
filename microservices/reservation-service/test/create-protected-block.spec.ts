import { afterEach, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { DomainError } from '@flight-platform/shared';
import { CreateReservation } from '../src/application/create-reservation';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

/** audit-48 H1 (REGLA 1): desde que el pago queda verificado hasta que la reserva queda persistida, todo error anula el pago y devuelve el original. */
const passenger = { passengerId: '00000000-0000-4000-8000-000000000002', passengerType: 'ADULT', birthDate: '1990-01-01' };
const itineraryId = '00000000-0000-4000-8000-000000000003'; const segmentId = '00000000-0000-4000-8000-000000000004';
const build = () => {
  const pricing = new FakePricingPort();
  pricing.holds.set('hold', { holdId: 'hold', ownerId: 'owner', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '420.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId, segments: [{ segmentId }], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', baggageAllowance: { checkedBaggageIncluded: 2 } }] }] });
  const payment = new FakePaymentVerifier(); const trail: string[] = [];
  const originalVerify = payment.verify.bind(payment); payment.verify = async (value) => { trail.push('payment.verify'); return originalVerify(value); };
  const originalVoid = payment.void.bind(payment); payment.void = async (value) => { trail.push('payment.void'); return originalVoid(value); };
  const store = new InMemoryReservationStore();
  const service = new CreateReservation(store, pricing, payment, new FakeAncillariesPort(), new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher());
  return { service, store, payment, trail };
};
const input = { ownerId: 'owner', holdId: 'hold', passengers: [passenger], payment: { paymentReference: 'pay_ok_prot' }, idempotencyKey: 'key-prot' };
afterEach(() => jest.restoreAllMocks());

it('PRT-01: con findByPnr siempre ocupado la compra se rechaza con PNR_CREATION_FAILED y el pago NI SIQUIERA se verifica', async () => {
  const { service, store, trail } = build();
  store.findByPnr = async () => ({}) as never;
  await expect(service.execute(input)).rejects.toThrow('PNR_CREATION_FAILED');
  expect(trail).toEqual([]);
  expect(await store.findByIdempotency('owner', 'key-prot')).toBeUndefined();
});

it('PRT-02: un fallo genérico entre el pago y la persistencia anula el pago y devuelve el error original', async () => {
  const { service, store, trail } = build();
  const boom = new Error('boom inesperado');
  store.create = async () => { throw boom; };
  await expect(service.execute(input)).rejects.toBe(boom);
  expect(trail).toEqual(['payment.verify', 'payment.void']);
});

it('PRT-03: un choque de PNR al insertar anula el pago y devuelve el error original', async () => {
  const { service, store, trail } = build();
  const clash = Object.assign(new Error('Unique constraint failed on pnr'), { code: 'P2002' });
  store.create = async () => { throw clash; };
  await expect(service.execute(input)).rejects.toBe(clash);
  expect(trail).toEqual(['payment.verify', 'payment.void']);
});

it('PRT-04: si la anulación también falla, se registra aparte (sin datos personales) y se devuelve igual el error original', async () => {
  const { service, store, payment, trail } = build();
  const logged: string[] = []; jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => { logged.push(String(message)); });
  const original = new DomainError('WEB_ACTIVE_LIMIT_EXCEEDED');
  store.create = async () => { throw original; };
  payment.void = async () => { trail.push('payment.void'); throw Object.assign(new Error('Booking caído'), { code: 14 }); };
  await expect(service.execute(input)).rejects.toBe(original);
  expect(trail).toEqual(['payment.verify', 'payment.void']);
  expect(logged.some((line) => line.includes('compensation step=payment.void failed'))).toBe(true);
  expect(logged.join('\n')).not.toMatch(/pay_ok_prot|owner|Booking caído/);
});

it('PRT-05: si el pago pertenece a OTRA reserva ya persistida (choque de referencia), no se anula', async () => {
  const { service, store, trail } = build();
  const clash = new DomainError('PAYMENT_REFERENCE_INVALID');
  store.create = async () => { throw clash; };
  let calls = 0; store.findByPaymentReference = async () => (++calls === 1 ? undefined : ({ id: 'otra' }) as never); // libre al validar; otra reserva la gana al insertar
  await expect(service.execute(input)).rejects.toBe(clash);
  expect(trail).toEqual(['payment.verify']);
});
