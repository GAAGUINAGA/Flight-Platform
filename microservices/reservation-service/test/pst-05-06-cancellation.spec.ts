import { expect, it } from '@jest/globals';
import { FixedClock } from '@flight-platform/shared';
import { CancellationQuoteRecord, CancellationQuotes } from '../src/application/cancellation-quotes';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { PostSaleCancellation } from '../src/application/post-sale-cancellation';
import { ReservationQueries } from '../src/application/queries';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';
import { createResponseValidator } from '../src/infrastructure/grpc/openapi-response-validator';

const bookingId = '00000000-0000-4000-8000-000000000001';
class MemoryQuotes implements CancellationQuotes {
  readonly values = new Map<string, CancellationQuoteRecord>();
  async save(value: CancellationQuoteRecord) { this.values.set(value.quoteId, value); }
  async find(ownerId: string, id: string, quoteId: string) { const item = this.values.get(quoteId); return item?.ownerId === ownerId && item.bookingId === id ? item : undefined; }
  async consume(ownerId: string, id: string, quoteId: string, at: Date) { const item = await this.find(ownerId, id, quoteId); if (!item || item.usedAt || item.expiresAt <= at) return false; item.usedAt = at; return true; }
}
const setup = async () => {
  const store = new InMemoryReservationStore();
  await store.create({ id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'hold', paymentReference: 'pay_ok_initial', idempotencyKey: 'create-key', passengers: [{ passengerId: 'p1', passengerType: 'ADULT' }], itineraries: [{ itineraryId: 'route', segments: [{ departure: { at: '2026-10-20T12:00:00.000Z' } }], pricingOptions: [{ fareRules: { isRefundable: true, isChangeable: true } }] }], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0 });
  const pricing = new FakePricingPort();
  pricing.quoteCancellation = async () => ({ quoteId: 'quote-1', isRefundable: true, refundAmount: '80.00', penaltyAmount: '20.00', currency: 'USD', expiresAt: '2026-10-17T00:15:00.000Z' });
  const quotes = new MemoryQuotes(); const payment = new FakePaymentVerifier(); const inventory = new FakeInventoryPort(); let released = 0;
  inventory.releaseReservedInventory = async () => { released += 1; };
  const ancillaries = new FakeAncillariesPort(); const tickets = new FakeTicketingPort(); tickets.tickets = [{ status: 'ISSUED' }];
  const events = new FakeEventPublisher();
  const service = new PostSaleCancellation(store, pricing, quotes, payment, inventory, ancillaries, tickets, events, new FixedClock(new Date('2026-10-17T00:00:00.000Z')), createResponseValidator());
  return { service, store, quotes, payment, tickets, events, ancillaries, released: () => released };
};

it('PST-05 / K: cotiza y persiste CancellationQuote con contrato OpenAPI', async () => {
  const test = await setup();
  const quote = await test.service.quote({ bookingId, ownerId: 'owner' });
  expect(quote).toMatchObject({ quoteId: 'quote-1', refundAmount: '80.00', currency: 'USD' });
  expect(await test.quotes.find('owner', bookingId, 'quote-1')).toBeDefined();
});

it('PST-06 / I: cancela, reembolsa, libera recursos y publica evento', async () => {
  const test = await setup(); await test.service.quote({ bookingId, ownerId: 'owner' });
  const result = await test.service.cancel({ bookingId, ownerId: 'owner', quoteId: 'quote-1', idempotencyKey: '00000000-0000-4000-8000-000000000009' });
  expect(result.status).toBe('CANCELLED'); expect(test.payment.refunded).toEqual([{ paymentReference: 'pay_ok_initial', amount: '80.00', currency: 'USD' }]);
  expect(test.tickets.tickets).toEqual([{ status: 'REFUNDED' }]); expect(test.released()).toBe(1);
  expect(test.ancillaries.released).toEqual([{ bookingId, ownerId: 'owner' }]);
  expect(test.events.events).toEqual([expect.objectContaining({ eventType: 'booking.cancelled', refundAmount: '80.00' })]);
});

it('PST-06 / I: ResumePending completa una cancelación que falló después de liquidar tickets', async () => {
  const test = await setup(); await test.service.quote({ bookingId, ownerId: 'owner' });
  test.tickets.refundTickets = async () => { test.tickets.tickets = [{ status: 'REFUNDED' }]; };
  let failRelease = true;
  const inventory = { releaseReservedInventory: async () => { if (failRelease) throw new Error('fallo temporal'); } };
  const booking = await test.store.findById('owner', bookingId);
  if (!booking) throw new Error('reserva no existe');
  booking.status = 'CANCEL_PENDING';
  booking.pendingOperation = { kind: 'CANCELLATION', quoteId: 'quote-1', refundAmount: '80.00', currency: 'USD', step: 'TICKETS_SETTLED' };
  await test.store.update(booking);
  const { ResumePending } = await import('../src/application/resume-pending');
  const resume = new ResumePending(test.store, test.payment, test.events, test.ancillaries, inventory, test.tickets);
  await expect(resume.execute({})).resolves.toEqual({ resumedCount: 0 });
  expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CANCEL_PENDING', pendingOperation: { step: 'TICKETS_SETTLED' } });
  failRelease = false;
  await expect(resume.execute({})).resolves.toEqual({ resumedCount: 1 });
  expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CANCELLED' });
  expect(test.ancillaries.released).toEqual([{ bookingId, ownerId: 'owner' }]);
});

it('PST-06 / S: un quote vencido o ya usado no vuelve a ejecutar el pago', async () => {
  const test = await setup(); await test.service.quote({ bookingId, ownerId: 'owner' });
  await test.service.cancel({ bookingId, ownerId: 'owner', quoteId: 'quote-1', idempotencyKey: '00000000-0000-4000-8000-000000000010' });
  await expect(test.service.cancel({ bookingId, ownerId: 'owner', quoteId: 'quote-1', idempotencyKey: '00000000-0000-4000-8000-000000000011' })).rejects.toThrow('BOOKING_NOT_CONFIRMED');
  expect(test.payment.refunded).toHaveLength(1);
});

it('PST-06 / S: quote vencido devuelve QUOTE_EXPIRED y conserva la reserva CONFIRMED', async () => {
  const test = await setup(); await test.service.quote({ bookingId, ownerId: 'owner' });
  const quote = test.quotes.values.get('quote-1');
  if (!quote) throw new Error('la cotización no quedó persistida');
  quote.expiresAt = new Date('2026-10-16T23:59:59.999Z');
  await expect(test.service.cancel({ bookingId, ownerId: 'owner', quoteId: 'quote-1', idempotencyKey: '00000000-0000-4000-8000-000000000013' })).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
  expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CONFIRMED', holdId: 'hold' });
  expect(test.payment.refunded).toHaveLength(0); expect(test.released()).toBe(0);
});

it('PST-06 / S: una reserva ajena no obtiene cotización', async () => {
  const test = await setup();
  await expect(test.service.quote({ bookingId, ownerId: 'other' })).rejects.toThrow('NOT_FOUND');
  expect(test.quotes.values.size).toBe(0);
});

it('PST-06 / K: cancellation parcial expone CANCELLATION_PENDING válido en OpenAPI', async () => {
  const test = await setup(); await test.service.quote({ bookingId, ownerId: 'owner' });
  test.tickets.refundTickets = async () => { throw new Error('dependency detail must stay internal'); };
  const pending = await test.service.cancel({ bookingId, ownerId: 'owner', quoteId: 'quote-1', idempotencyKey: '00000000-0000-4000-8000-000000000012' });
  expect(pending.status).toBe('CANCEL_PENDING');
  const saved = await test.store.findById('owner', bookingId); if (saved) { saved.itineraries = []; saved.passengers = []; }
  const detail = await new ReservationQueries(test.store).get({ bookingId, ownerId: 'owner' });
  expect(detail.status).toBe('CANCELLATION_PENDING');
  expect(() => createResponseValidator()('BookingDetail', detail)).not.toThrow();
});
