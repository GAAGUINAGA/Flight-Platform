import { expect, it } from '@jest/globals';
import { FixedClock } from '@flight-platform/shared';
import { BaggageOperation, BaggageOperations, BaggageResult } from '../src/application/baggage-operations';
import { PostSaleBaggage } from '../src/application/post-sale-baggage';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakePaymentVerifier } from '../src/infrastructure/clients/fakes';
import { createResponseValidator } from '../src/infrastructure/grpc/openapi-response-validator';

const ids = { bookingId: '00000000-0000-4000-8000-000000000001', passengerId: '00000000-0000-4000-8000-000000000002', itineraryId: '00000000-0000-4000-8000-000000000003', idempotencyKey: '00000000-0000-4000-8000-000000000004' };
const input = { ...ids, ownerId: 'owner', quantity: 1, payment: { paymentReference: 'pay_ok_test' } };
class MemoryOperations implements BaggageOperations {
  readonly values = new Map<string, BaggageOperation>();
  async find(ownerId: string, key: string) { return this.values.get(`${ownerId}:${key}`); }
  async claim(value: BaggageOperation) { this.values.set(`${value.ownerId}:${value.idempotencyKey}`, value); return value; }
  async complete(operation: BaggageOperation, at: Date, action: () => Promise<BaggageResult>) { void at; if (operation.response) return operation.response; operation.response = await action(); operation.status = 'COMPLETED'; return operation.response; }
}
const setup = async (departure: string) => {
  const reservations = new InMemoryReservationStore();
  await reservations.create({ id: ids.bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'hold', paymentReference: 'pay_ok_booking', idempotencyKey: 'booking', passengers: [{ passengerId: ids.passengerId, passengerType: 'ADULT' }], itineraries: [{ itineraryId: ids.itineraryId, segments: [{ departure: { at: departure } }], pricingOptions: [{ extraCheckedBaggagePrice: { currency: 'USD', total: '25.00' } }] }], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0 });
  const ancillary = new FakeAncillariesPort();
  ancillary.getBaggageOptions = async () => [{ passengerId: ids.passengerId, itineraryId: ids.itineraryId, maxAllowed: 2, alreadyPurchased: 0, checkedBaggageIncluded: 1 }];
  let purchases = 0;
  ancillary.purchaseBaggage = async (value) => { purchases += 1; return { passengerId: value.passengerId, itineraryId: value.itineraryId, totalBaggage: 2 }; };
  const payments = new FakePaymentVerifier(); const paid: unknown[] = [];
  payments.verify = async (value) => { paid.push(value); return 'AUTHORIZED'; };
  const events = new FakeEventPublisher();
  const service = new PostSaleBaggage(reservations, ancillary, payments, new MemoryOperations(), events, new FixedClock(new Date('2026-10-17T00:00:00.000Z')), 4, createResponseValidator());
  return { service, paid, events, purchases: () => purchases };
};
it('PST-02 / U: el cutoff de cuatro horas es inclusivo', async () => {
  const { service, paid, purchases } = await setup('2026-10-17T04:00:00.000Z');
  await expect(service.add(input)).rejects.toThrow('CUTOFF_PASSED');
  expect(paid).toHaveLength(0); expect(purchases()).toBe(0);
});
it('PST-02 / I: calcula pago, compra una vez y publica booking.baggage_added', async () => {
  const { service, paid, events, purchases } = await setup('2026-10-18T00:00:00.000Z');
  const result = await service.add(input); const repeated = await service.add(input);
  expect(result).toEqual({ passengerId: ids.passengerId, itineraryId: ids.itineraryId, totalBaggage: 2 });
  expect(repeated).toEqual(result); expect(purchases()).toBe(1);
  expect(paid).toEqual([expect.objectContaining({ currency: 'USD', total: '25.00' })]);
  expect(events.events).toEqual([expect.objectContaining({ bookingId: ids.bookingId, eventType: 'booking.baggage_added' })]);
});
it('PST-02 / K: opciones usan el precio de la tarifa y cumplen OpenAPI', async () => {
  const { service } = await setup('2026-10-18T00:00:00.000Z');
  await expect(service.options({ bookingId: ids.bookingId, ownerId: 'owner' })).resolves.toEqual([{ passengerId: ids.passengerId, itineraryId: ids.itineraryId, maxAllowed: 2, alreadyPurchased: 0, price: { currency: 'USD', total: '25.00' } }]);
});
