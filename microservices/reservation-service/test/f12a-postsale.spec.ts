import { describe, expect, it } from '@jest/globals';
import { FixedClock } from '@flight-platform/shared';
import { refundIdFor, seatsOf } from '../src/application/allocation';
import { CancellationQuoteRecord, CancellationQuotes } from '../src/application/cancellation-quotes';
import { PostSaleCancellation } from '../src/application/post-sale-cancellation';
import { InMemoryReservationStore, StoredReservation } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';
import { createResponseValidator } from '../src/infrastructure/grpc/openapi-response-validator';

const bookingId = '00000000-0000-4000-8000-000000000001';
class MemoryQuotes implements CancellationQuotes {
  readonly values = new Map<string, CancellationQuoteRecord>();
  async save(value: CancellationQuoteRecord) { this.values.set(value.quoteId, value); }
  async find(ownerId: string, id: string, quoteId: string) { const item = this.values.get(quoteId); return item?.ownerId === ownerId && item.bookingId === id ? item : undefined; }
  async consume(ownerId: string, id: string, quoteId: string, at: Date) { const item = await this.find(ownerId, id, quoteId); if (!item || item.usedAt || item.expiresAt <= at) return false; item.usedAt = at; return true; }
}
const reservation = (overrides: Partial<StoredReservation> = {}): StoredReservation => ({ id: bookingId, ownerId: 'client~u1', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'hold', paymentReference: 'PAY-1', idempotencyKey: 'k', passengers: [{ passengerId: 'p1', passengerType: 'ADULT' }, { passengerId: 'p2', passengerType: 'INFANT' }], itineraries: [{ itineraryId: 'route', segments: [{ departure: { at: '2026-10-20T12:00:00.000Z' } }], pricingOptions: [{ fareRules: { isRefundable: false, isChangeable: true } }] }], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0, ...overrides });
const setup = async (overrides: Partial<StoredReservation> = {}) => {
  const store = new InMemoryReservationStore(); await store.create(reservation(overrides));
  const pricing = new FakePricingPort(); pricing.quoteCancellation = async () => ({ quoteId: 'quote-1', isRefundable: false, refundAmount: '0.00', penaltyAmount: '100.00', currency: 'USD', expiresAt: '2026-10-17T00:15:00.000Z' });
  const quotes = new MemoryQuotes(); const tickets = new FakeTicketingPort(); tickets.tickets = [{ status: 'ISSUED' }]; const events = new FakeEventPublisher();
  const service = new PostSaleCancellation(store, pricing, quotes, new FakePaymentVerifier(), new FakeInventoryPort(), new FakeAncillariesPort(), tickets, events, new FixedClock(new Date('2026-10-17T00:00:00.000Z')), createResponseValidator());
  return { service, quotes, events: events.events as Array<{ eventType: string; refundAmount?: string; extra?: Record<string, unknown> }> };
};

describe('F12a postventa v2 en Reservation (D5)', () => {
  it('PSV2-01: sin exención la cotización es la de la tarifa (sin cambios para v1)', async () => {
    const { service } = await setup(); await expect(service.quote({ bookingId, ownerId: 'client~u1' })).resolves.toMatchObject({ refundAmount: '0.00', penaltyAmount: '100.00', isRefundable: false });
  });
  it('PSV2-02: con waivePenalty el reembolso es el total, la penalidad cero y se guarda esa cotización', async () => {
    const { service, quotes } = await setup(); const quote = await service.quote({ bookingId, ownerId: 'client~u1', waivePenalty: true });
    expect(quote).toMatchObject({ quoteId: 'quote-1', isRefundable: true, refundAmount: '100.00', penaltyAmount: '0.00', currency: 'USD' }); expect((quotes.values.get('quote-1')?.payload as { refundAmount: string }).refundAmount).toBe('100.00');
  });
  it('PSV2-03: storedQuote devuelve la cotización emitida, también usada, y QUOTE_EXPIRED si no existe o es de otra reserva', async () => {
    const { service } = await setup(); await service.quote({ bookingId, ownerId: 'client~u1', waivePenalty: true }); await service.cancel({ bookingId, ownerId: 'client~u1', quoteId: 'quote-1', idempotencyKey: 'c1' });
    await expect(service.storedQuote({ bookingId, ownerId: 'client~u1', quoteId: 'quote-1' })).resolves.toMatchObject({ refundAmount: '100.00' });
    await expect(service.storedQuote({ bookingId, ownerId: 'client~u1', quoteId: 'otra' })).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' }); await expect(service.storedQuote({ bookingId, ownerId: 'otro', quoteId: 'quote-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('PSV2-04: una reserva v2 publica booking.cancelled con causa, refundId y asientos; la de v1 sale como siempre', async () => {
    const v2 = await setup({ paymentChannel: 'BOOKING' }); await v2.service.quote({ bookingId, ownerId: 'client~u1', waivePenalty: true }); await v2.service.cancel({ bookingId, ownerId: 'client~u1', quoteId: 'quote-1', reasonCode: 'SAGA_COMPENSATION', idempotencyKey: 'c1' });
    expect(v2.events).toHaveLength(1); expect(v2.events[0]).toMatchObject({ eventType: 'booking.cancelled', refundAmount: '100.00', extra: { reasonCode: 'SAGA_COMPENSATION', refundId: refundIdFor('quote-1'), seatsReleased: 1, grandTotal: { total: '100.00' } } });
    const v1 = await setup(); await v1.service.quote({ bookingId, ownerId: 'client~u1' }); await v1.service.cancel({ bookingId, ownerId: 'client~u1', quoteId: 'quote-1', idempotencyKey: 'c2' }); expect(v1.events[0].extra).toBeUndefined();
  });
  it('PSV2-05: sin reasonCode la causa del evento es CUSTOMER_REQUEST', async () => {
    const { service, events } = await setup({ paymentChannel: 'BOOKING' }); await service.quote({ bookingId, ownerId: 'client~u1' }); await service.cancel({ bookingId, ownerId: 'client~u1', quoteId: 'quote-1', idempotencyKey: 'c1' }); expect(events[0].extra).toMatchObject({ reasonCode: 'CUSTOMER_REQUEST' });
  });
  it('PSV2-06: refundIdFor es estable por cotización, con formato REF-VUE-XXXXXXXX y distinto entre cotizaciones', () => {
    expect(refundIdFor('q')).toBe(refundIdFor('q')); expect(refundIdFor('q')).toMatch(/^REF-VUE-[0-9A-F]{8}$/); expect(refundIdFor('q')).not.toBe(refundIdFor('r'));
  });
  it('PSV2-07: seatsOf no cuenta a los infantes', () => { expect(seatsOf(reservation())).toBe(1); expect(seatsOf(reservation({ passengers: [{ passengerType: 'ADULT' }, { passengerType: 'CHILD' }] }))).toBe(2); });
});
