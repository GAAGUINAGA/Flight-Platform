import { expect, it } from '@jest/globals';
import { FixedClock } from '@flight-platform/shared';
import { ConfirmDateChange } from '../src/application/confirm-date-change';
import { ResumePending } from '../src/application/resume-pending';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

const bookingId = '00000000-0000-4000-8000-000000000001';
const itineraryId = '00000000-0000-4000-8000-000000000002';
const passengerId = '00000000-0000-4000-8000-000000000003';
const oldSegment = { segmentId: 'seg-old', flightInstanceId: '00000000-0000-4000-8000-000000000004', departure: { iataCode: 'BOG', at: '2026-10-25T12:00:00.000Z' }, arrival: { iataCode: 'MDE', at: '2026-10-25T13:00:00.000Z' } };
const newSegment = { segmentId: 'seg-new', flightInstanceId: '00000000-0000-4000-8000-000000000005', departure: { iataCode: 'BOG', at: '2026-10-20T12:00:00.000Z' }, arrival: { iataCode: 'MDE', at: '2026-10-20T13:00:00.000Z' } };

const setup = async (failure?: 'consume' | 'reissue', offerExpiry = '2026-10-17T00:15:00.000Z') => {
  const store = new InMemoryReservationStore();
  await store.create({ id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'old-hold', paymentReference: 'pay_ok_initial', idempotencyKey: 'create-key', passengers: [{ passengerId, passengerType: 'ADULT' }], itineraries: [{ itineraryId, segments: [oldSegment], pricingOptions: [{ cabinClass: 'ECONOMY', fareBrand: 'CLASSIC', fareRules: { isChangeable: true } }] }], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0 });
  const pricing = new FakePricingPort(); let used = 0;
  pricing.getChangeOffer = async () => ({ changeOfferId: 'offer-1', expiresAt: offerExpiry, segments: [newSegment], priceDifference: { totalToPay: '25.00' } });
  pricing.markChangeOfferUsed = async () => { used += 1; };
  const inventory = new FakeInventoryPort(); let consumed = 0; let released = 0; const inventoryOrder: string[] = [];
  inventory.createHold = async () => ({ holdId: 'new-hold' });
  inventory.consumeHold = async () => { inventoryOrder.push('consume-new'); if (failure === 'consume') throw new Error('dependency details'); consumed += 1; };
  inventory.releaseReservedInventory = async () => { inventoryOrder.push('release-old'); released += 1; };
  const ancillaries = new FakeAncillariesPort(); const reservedSeats: unknown[] = [];
  ancillaries.reserveSeats = async (input) => { reservedSeats.push(...input.assignments); };
  const tickets = new FakeTicketingPort(); let reissued = 0;
  tickets.reissueTickets = async () => { reissued += 1; if (failure === 'reissue') throw new Error('dependency details'); return [{ status: 'ISSUED' }]; };
  const payment = new FakePaymentVerifier(); const events = new FakeEventPublisher();
  const service = new ConfirmDateChange(store, pricing, payment, inventory, ancillaries, tickets, events, new FixedClock(new Date('2026-10-17T00:00:00.000Z')), 20);
  return { service, store, pricing, used: () => used, consumed: () => consumed, released: () => released, inventoryOrder, reservedSeats, reissued: () => reissued, ancillaries, events };
};

it('PST-04 / I: confirma el cambio, consume el nuevo hold, libera el anterior y reemite', async () => {
  const test = await setup();
  const result = await test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_change' }, assignedSeats: [{ segmentId: 'seg-new', seatNumber: '2A' }], idempotencyKey: '00000000-0000-4000-8000-000000000006' });
  expect(result.status).toBe('CONFIRMED'); expect(result.holdId).toBe('new-hold');
  expect((result.itineraries[0] as { segments: unknown[] }).segments).toEqual([newSegment]);
  expect(result.grandTotal.total).toBe('125.00'); expect(test.used()).toBe(1);
  expect(test.consumed()).toBe(1); expect(test.released()).toBe(1);
  expect(test.inventoryOrder).toEqual(['release-old', 'consume-new']);
  expect(test.ancillaries.released).toEqual([{ bookingId, ownerId: 'owner' }]);
  expect(test.reservedSeats).toEqual([expect.objectContaining({ segmentId: 'seg-new', seatNumber: '2A', passengerId, cabinClass: 'ECONOMY' })]);
  expect(test.reissued()).toBe(1);
  expect(test.events.events).toEqual([expect.objectContaining({ eventType: 'booking.changed', status: 'CONFIRMED' })]);
});

it('PST-04 / S: una tarifa BASIC responde FARE_NOT_CHANGEABLE sin efectos', async () => {
  const test = await setup();
  const booking = await test.store.findById('owner', bookingId);
  (booking!.itineraries[0] as { pricingOptions: Array<{ fareRules: { isChangeable: boolean } }> }).pricingOptions[0].fareRules = { isChangeable: false };
  let getOfferCalled = false; let markUsedCalled = false;
  test.pricing.getChangeOffer = async () => { getOfferCalled = true; return { changeOfferId: 'offer-1', expiresAt: '2026-10-17T00:15:00.000Z', segments: [newSegment], priceDifference: { totalToPay: '25.00' } }; };
  test.pricing.markChangeOfferUsed = async () => { markUsedCalled = true; };
  await test.store.update(booking!);
  await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_basic' }, assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000015' })).rejects.toMatchObject({ code: 'FARE_NOT_CHANGEABLE' });
  expect(getOfferCalled).toBe(false); expect(markUsedCalled).toBe(false);
  expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CONFIRMED', holdId: 'old-hold', grandTotal: { total: '100.00' } });
  expect(test.consumed()).toBe(0); expect(test.released()).toBe(0); expect(test.ancillaries.released).toEqual([]); expect(test.reissued()).toBe(0); expect(test.events.events).toEqual([]);
});

it('PST-04 / S: ChangeOffer vencido devuelve CHANGE_OFFER_EXPIRED sin cambiar la reserva', async () => {
  const test = await setup(undefined, '2026-10-16T23:59:59.999Z');
  await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_expired' }, assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000014' })).rejects.toMatchObject({ code: 'CHANGE_OFFER_EXPIRED' });
  expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CONFIRMED', holdId: 'old-hold', grandTotal: { total: '100.00' } });
  expect(test.used()).toBe(0); expect(test.consumed()).toBe(0); expect(test.released()).toBe(0);
});

it('PST-04 / I: fallo parcial deja la reserva en CHANGE_PENDING', async () => {
  const test = await setup('reissue');
  const result = await test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_partial' }, assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000007' });
  expect(result.status).toBe('CHANGE_PENDING');
  expect((await test.store.findById('owner', bookingId))?.status).toBe('CHANGE_PENDING');
});

it('PST-04 / S: un cambio no usa el offer de otro owner', async () => {
  const test = await setup();
  await expect(test.service.execute({ bookingId, ownerId: 'other', changeOfferId: 'offer-1', assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000008' })).rejects.toThrow('NOT_FOUND');
  expect(test.used()).toBe(0);
});

it('PST-04 / I: ResumePending completa una reemisión que quedó pendiente', async () => {
  const store = new InMemoryReservationStore();
  const booking = { id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CHANGE_PENDING', holdId: 'new-hold', paymentReference: 'pay_ok_initial', idempotencyKey: 'create-key', passengers: [{ passengerId, passengerType: 'ADULT' }], itineraries: [{ itineraryId, segments: [newSegment], pricingOptions: [{ cabinClass: 'ECONOMY' }] }], grandTotal: { currency: 'USD', total: '125.00' }, changes: [], attempts: 0, pendingOperation: { kind: 'DATE_CHANGE' as const, previousHoldId: 'old-hold', changeOfferId: 'offer-1', assignedSeats: [], step: 'OLD_INVENTORY_RELEASED' as const } };
  await store.create(booking);
  const inventory = new FakeInventoryPort(); const ancillaries = new FakeAncillariesPort();
  const tickets = new FakeTicketingPort(); tickets.reissueTickets = async () => [{ status: 'ISSUED' }];
  const events = new FakeEventPublisher();
  const resume = new ResumePending(store, new FakePaymentVerifier(), events, ancillaries, inventory, tickets);
  await expect(resume.execute({})).resolves.toEqual({ resumedCount: 1 });
  expect((await store.findById('owner', bookingId))?.status).toBe('CONFIRMED');
  expect(events.events).toEqual([expect.objectContaining({ eventType: 'booking.changed' })]);
});

it('PST-SEC-02 / S: la reserva reclama referencias de pago de forma atómica y global', async () => {
  const store = new InMemoryReservationStore();
  await store.create({ id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'old-hold', paymentReference: 'pay_ok_initial', idempotencyKey: 'create-key', passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0 });
  await expect(store.claimPaymentReference('pay_ok_initial', bookingId)).rejects.toThrow('PAYMENT_REFERENCE_INVALID');
  await store.claimPaymentReference('pay_ok_change', bookingId);
  await expect(store.claimPaymentReference('pay_ok_change', bookingId)).rejects.toThrow('PAYMENT_REFERENCE_INVALID');
});
