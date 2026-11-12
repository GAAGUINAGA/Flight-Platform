import { describe, expect, it } from '@jest/globals';
import { DomainError } from '@flight-platform/shared';
import { CreateReservation } from '../src/application/create-reservation';
import { PaymentResult, PaymentVerifier } from '../src/application/ports';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';
import { RoutingPaymentVerifier } from '../src/infrastructure/clients/routing-payment-verifier';
import { WebPaymentVerifier, warnWebPayments, webPaymentModeFromEnv } from '../src/infrastructure/clients/web-payments';

const passenger = { passengerId: 'pax-1', passengerType: 'ADULT', birthDate: '1990-01-01' };
const ISSUED = [{ status: 'ISSUED', ticketId: 't-1', eTicketNumber: '1234567890123', passengerId: 'pax-1' }];
class BookingScripted implements PaymentVerifier {
  calls = 0;
  async verify(): Promise<PaymentResult> { this.calls += 1; return 'AUTHORIZED'; }
  async void(): Promise<void> { /* nada */ }
}
const input = (paymentReference: string, channel?: string) => ({ paymentReference, currency: 'USD', total: '100.00', ...(channel ? { channel } : {}) });
const rejects = async (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

describe('F12c B-1: canal de pago WEB (pago simulado de prueba)', () => {
  it('RSV-WEB-01: WEB_PAYMENT_MODE solo reconoce exactamente "simulated"; ausente o desconocido es off', () => {
    expect(webPaymentModeFromEnv({ WEB_PAYMENT_MODE: 'simulated' })).toBe('simulated');
    expect(webPaymentModeFromEnv({ WEB_PAYMENT_MODE: ' simulated ' })).toBe('simulated');
    for (const value of [undefined, '', 'off', 'SIMULATED', 'real', 'true', '1']) expect(webPaymentModeFromEnv({ WEB_PAYMENT_MODE: value })).toBe('off');
  });
  it('RSV-WEB-02: con modo off todo pago del canal WEB se rechaza con PAYMENT_NOT_AUTHORIZED (incluso pay_ok_*)', async () => {
    const web = new WebPaymentVerifier('off', new FakePaymentVerifier());
    const error = await rejects(web.verify(input('pay_ok_1', 'WEB')));
    expect(error).toBeInstanceOf(DomainError); expect((error as DomainError).code).toBe('PAYMENT_NOT_AUTHORIZED');
  });
  it('RSV-WEB-03: con simulated usa las reglas del verificador simulado: ok autoriza, pending queda pendiente, el resto se rechaza', async () => {
    const web = new WebPaymentVerifier('simulated', new FakePaymentVerifier());
    await expect(web.verify(input('pay_ok_1'))).resolves.toBe('AUTHORIZED');
    await expect(web.verify(input('pay_pending_1'))).resolves.toBe('PENDING');
    expect(((await rejects(web.verify(input('pay_denied_1')))) as DomainError).code).toBe('PAYMENT_NOT_AUTHORIZED');
    expect(((await rejects(web.verify(input('pay_invalid_1')))) as DomainError).code).toBe('PAYMENT_REFERENCE_INVALID');
    expect(((await rejects(web.verify(input('PAY-BKP-1')))) as DomainError).code).toBe('PAYMENT_REFERENCE_INVALID');
  });
  it('RSV-WEB-04: el enrutador manda WEB al verificador WEB y BOOKING al de Booking sin tocarse; un canal desconocido sigue rechazándose', async () => {
    const booking = new BookingScripted(); const router = new RoutingPaymentVerifier(new FakePaymentVerifier(), { BOOKING: booking, WEB: new WebPaymentVerifier('simulated', new FakePaymentVerifier()) });
    await expect(router.verify(input('pay_ok_web', 'WEB'))).resolves.toBe('AUTHORIZED'); expect(booking.calls).toBe(0);
    await expect(router.verify(input('PAY-BKP-9', 'BOOKING'))).resolves.toBe('AUTHORIZED'); expect(booking.calls).toBe(1);
    expect(((await rejects(router.verify(input('pay_ok_x', 'OTRO')))) as DomainError).code).toBe('VALIDATION_FAILED');
  });
  it('RSV-WEB-05: una referencia de Booking no vale en el canal WEB y una pay_ok_* no vale en el canal BOOKING real', async () => {
    const router = new RoutingPaymentVerifier(new FakePaymentVerifier(), { WEB: new WebPaymentVerifier('simulated', new FakePaymentVerifier()), BOOKING: { async verify() { throw new DomainError('PAYMENT_NOT_AUTHORIZED'); }, async void() { /* nada */ } } });
    expect(((await rejects(router.verify(input('PAY-BKP-20261108-1', 'WEB')))) as DomainError).code).toBe('PAYMENT_REFERENCE_INVALID');
    expect(((await rejects(router.verify(input('pay_ok_1', 'BOOKING')))) as DomainError).code).toBe('PAYMENT_NOT_AUTHORIZED');
  });
  it('RSV-WEB-06: una reserva WEB con modo off no consume el hold ni se crea; con simulated confirma, guarda canal WEB y emite boletos', async () => {
    const build = (mode: 'simulated' | 'off') => {
      const pricing = new FakePricingPort(); pricing.holds.set('hold', { holdId: 'hold', ownerId: 'user-1', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '100.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId: '00000000-0000-4000-8000-000000000301', pricingOptions: [{ baggageAllowance: { checkedBaggageIncluded: 0 } }] }] });
      const store = new InMemoryReservationStore(); const ticketing = new FakeTicketingPort(); ticketing.tickets = ISSUED;
      const payment = new RoutingPaymentVerifier(new FakePaymentVerifier(), { WEB: new WebPaymentVerifier(mode, new FakePaymentVerifier()) });
      return { store, create: new CreateReservation(store, pricing, payment, new FakeAncillariesPort(), new FakeInventoryPort(), ticketing, new FakeEventPublisher()) };
    };
    const book = (w: ReturnType<typeof build>) => w.create.execute({ ownerId: 'user-1', holdId: 'hold', passengers: [passenger], payment: { paymentReference: 'pay_ok_web1' }, idempotencyKey: 'k1', paymentChannel: 'WEB', webMaxActiveBookings: 5, webMaxPassengersPerDay: 10, deferIssuanceFailure: true });
    const off = build('off'); expect(((await rejects(book(off))) as DomainError).code).toBe('PAYMENT_NOT_AUTHORIZED'); expect(off.store.values.size).toBe(0);
    const on = build('simulated'); const result = await book(on);
    expect(result).toMatchObject({ status: 'CONFIRMED', paymentChannel: 'WEB' });
  });
  it('RSV-WEB-07: el aviso de arranque no revela valores y distingue simulated de off', () => {
    const lines: string[] = []; const logger = { warn: (message: string) => lines.push(message) } as never;
    warnWebPayments('simulated', logger); warnWebPayments('off', logger);
    expect(lines[0]).toContain('SIMULADOS'); expect(lines[1]).toContain('rechaza todo pago');
  });
});
