import { expect, it } from '@jest/globals';
import { CreateReservation } from '../src/application/create-reservation';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

/** fix-compra-ejecutiva: una compensación que falla no reemplaza el error original ni corta las demás compensaciones. */
const passenger = { passengerId: '00000000-0000-4000-8000-000000000002', passengerType: 'ADULT', birthDate: '1990-01-01' };
const itineraryId = '00000000-0000-4000-8000-000000000003'; const segmentId = '00000000-0000-4000-8000-000000000004';
const build = () => {
  const pricing = new FakePricingPort();
  pricing.holds.set('hold', { holdId: 'hold', ownerId: 'owner', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '420.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId, segments: [{ segmentId }], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', baggageAllowance: { checkedBaggageIncluded: 2 } }] }] });
  const ancillaries = new FakeAncillariesPort(); const payment = new FakePaymentVerifier(); const events = new FakeEventPublisher();
  const trail: string[] = []; const published: Array<Record<string, unknown>> = []; const releases: Array<Record<string, unknown>> = [];
  ancillaries.getHeldSeats = async () => [{ segmentId, seatNumber: '2A' }];
  ancillaries.reserveSeats = async () => { trail.push('reserveSeats'); throw Object.assign(new Error('9 FAILED_PRECONDITION'), { code: 9, details: 'SEAT_CABIN_MISMATCH' }); };
  ancillaries.releaseAll = async (value) => { trail.push('releaseAll'); releases.push(value); throw Object.assign(new Error('3 INVALID_ARGUMENT'), { code: 3, details: 'VALIDATION_FAILED' }); };
  const originalVoid = payment.void.bind(payment); payment.void = async (value) => { trail.push('payment.void'); return originalVoid(value); };
  events.publish = (async (value: Record<string, unknown>) => { trail.push('events.publish'); published.push(value); }) as never;
  const store = new InMemoryReservationStore();
  const service = new CreateReservation(store, pricing, payment, ancillaries, new FakeInventoryPort(), new FakeTicketingPort(), events);
  return { service, trail, published, releases, store };
};
const input = { ownerId: 'owner', holdId: 'hold', passengers: [passenger], payment: { paymentReference: 'pay_ok_comp' }, idempotencyKey: 'key-comp' };

it('COMP-01: si reserveSeats falla y releaseAll también, se devuelve el error ORIGINAL, y aun así se anula el pago y se publica booking.failed', async () => {
  const { service, trail, published, releases, store } = build();
  await expect(service.execute(input)).rejects.toMatchObject({ code: 9, details: 'SEAT_CABIN_MISMATCH' });
  expect(trail).toEqual(['reserveSeats', 'releaseAll', 'payment.void', 'events.publish']);
  expect(releases[0]).toMatchObject({ ownerId: 'owner', restoreHold: true });
  expect(published[0]).toMatchObject({ eventType: 'booking.failed', status: 'FAILED' });
  expect((await store.findByIdempotency('owner', 'key-comp'))?.status).toBe('FAILED');
});
