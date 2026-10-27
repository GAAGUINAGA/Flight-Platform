import { beforeEach, describe, expect, it } from '@jest/globals';
import { DomainError } from '@flight-platform/shared';
import { allocationOf, deterministicEventId } from '../src/application/allocation';
import { CreateReservation } from '../src/application/create-reservation';
import { FailReservation } from '../src/application/fail-reservation';
import { InventoryPort, PaymentResult, PaymentVerifier } from '../src/application/ports';
import { InMemoryReservationStore, StoredReservation } from '../src/application/reservation-store';
import { ResumePending } from '../src/application/resume-pending';
import { FakeAncillariesPort, FakeEventPublisher, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';
import { RoutingPaymentVerifier } from '../src/infrastructure/clients/routing-payment-verifier';

const passenger = { passengerId: 'pax-1', passengerType: 'ADULT', birthDate: '1990-01-01' };
const withSeat = { ...passenger, assignedSeats: [{ segmentId: 'seg-1', seatNumber: '12A' }] };
const ISSUED = [{ status: 'ISSUED', ticketId: 't-1', eTicketNumber: '1234567890123', passengerId: 'pax-1' }];

/** Verificador de canal controlable: el resultado de cada llamada lo decide la prueba. */
class ScriptedPayment implements PaymentVerifier {
  next: PaymentResult | Error = 'AUTHORIZED'; readonly calls: Array<{ paymentReference: string; channel?: string; total: string }> = []; readonly voided: string[] = [];
  async verify(input: { paymentReference: string; currency: string; total: string; channel?: string }): Promise<PaymentResult> { this.calls.push({ paymentReference: input.paymentReference, channel: input.channel, total: input.total }); if (this.next instanceof Error) throw this.next; return this.next; }
  async void(input: { paymentReference: string }): Promise<void> { this.voided.push(input.paymentReference); }
}
class RecordingInventory implements InventoryPort { consumed: string[] = []; releasedFor: string[] = []; failConsume?: Error; async consumeHold(input: { holdId: string }) { if (this.failConsume) throw this.failConsume; this.consumed.push(input.holdId); } async releaseReservedInventory(input: { bookingId: string }) { this.releasedFor.push(input.bookingId); } }
class RecordingPricing extends FakePricingPort { releasedHolds: string[] = []; async releaseHold(input: { holdId: string }) { this.releasedHolds.push(input.holdId); } }
class RecordingAncillaries extends FakeAncillariesPort { seatsReserved = 0; confirmed = 0; failSeats?: Error; async reserveSeats() { if (this.failSeats) throw this.failSeats; this.seatsReserved += 1; } async confirmSeats() { this.confirmed += 1; } }

function world() {
  const pricing = new RecordingPricing(); pricing.holds.set('hold', { holdId: 'hold', ownerId: 'client-a~user-1', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '100.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId: '00000000-0000-4000-8000-000000000301', pricingOptions: [{ baggageAllowance: { checkedBaggageIncluded: 0 } }] }] });
  pricing.holds.set('hold-v1', { ...pricing.holds.get('hold')!, holdId: 'hold-v1', ownerId: 'owner-v1' });
  const store = new InMemoryReservationStore(); const channel = new ScriptedPayment(); const legacy = new FakePaymentVerifier(); const payment = new RoutingPaymentVerifier(legacy, { BOOKING: channel });
  const ancillaries = new RecordingAncillaries(); const inventory = new RecordingInventory(); const ticketing = new FakeTicketingPort(); ticketing.tickets = ISSUED; const events = new FakeEventPublisher();
  const create = new CreateReservation(store, pricing, payment, ancillaries, inventory, ticketing, events);
  const resume = new ResumePending(store, payment, events, ancillaries, inventory, ticketing, pricing);
  const fail = new FailReservation(store, payment, events, ancillaries, inventory, ticketing, pricing);
  const book = (extra: Record<string, unknown> = {}, ownerId = 'client-a~user-1') => create.execute({ ownerId, holdId: 'hold', passengers: [passenger], payment: { paymentReference: 'PAY-1' }, idempotencyKey: `k-${Math.random()}`, paymentChannel: 'BOOKING', ...extra });
  const published = () => (events.events as Array<{ eventType: string; extra?: Record<string, unknown>; eventId?: string }>);
  return { pricing, store, channel, legacy, ancillaries, inventory, ticketing, events, create, resume, fail, book, published };
}

describe('F12a v2: pago por canal, emisión diferida y eventos de la reserva', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => { w = world(); });

  it('RSV-V2-01: con canal BOOKING y pago aprobado confirma, guarda el canal y publica booking.confirmed y booking.ticket_issued con sus datos', async () => {
    const result = await w.book();
    expect(result).toMatchObject({ status: 'CONFIRMED', paymentChannel: 'BOOKING' }); expect(w.channel.calls).toEqual([{ paymentReference: 'PAY-1', channel: 'BOOKING', total: '100.00' }]);
    expect(w.published().map((e) => e.eventType)).toEqual(['booking.confirmed', 'booking.ticket_issued']);
    expect(w.published()[0].extra).toEqual({ grandTotal: { currency: 'USD', total: '100.00' } });
    expect(w.published()[1].extra).toMatchObject({ paymentReference: 'PAY-1', tickets: [{ ticketId: 't-1', eTicketNumber: '1234567890123', passengerId: 'pax-1' }] });
    expect(w.published()[1].eventId).toBe(deterministicEventId(result.id, 'booking.ticket_issued')); expect(w.published()[1].eventId).not.toBe(result.id);
  });
  it('RSV-V2-02: v1 (sin canal) no cambia: un solo booking.confirmed, sin extra ni ticket_issued, y el verificador de siempre', async () => {
    const result = await w.create.execute({ ownerId: 'owner-v1', holdId: 'hold-v1', passengers: [passenger], payment: { paymentReference: 'pay_ok_v1' }, idempotencyKey: 'v1-key' });
    expect(result.status).toBe('CONFIRMED'); expect(result.paymentChannel).toBeUndefined(); expect(w.channel.calls).toHaveLength(0);
    expect(w.published()).toHaveLength(1); expect(w.published()[0]).toMatchObject({ eventType: 'booking.confirmed' }); expect(w.published()[0].extra).toBeUndefined();
  });
  it('RSV-V2-03: Ticketing caído con deferIssuanceFailure deja la reserva en TICKET_ISSUING con el hold consumido y sin eventos', async () => {
    w.ticketing.failAlways = true; const result = await w.book({ deferIssuanceFailure: true });
    expect(result.status).toBe('TICKET_ISSUING'); expect(w.inventory.consumed).toEqual(['hold']); expect(w.published()).toHaveLength(0); expect([...w.store.values.values()][0].status).toBe('TICKET_ISSUING');
  });
  it('RSV-V2-04: sin deferIssuanceFailure el fallo de Ticketing se propaga como siempre', async () => {
    w.ticketing.failAlways = true; await expect(w.book()).rejects.toThrow('ticketing failed'); expect([...w.store.values.values()][0].status).toBe('TICKET_ISSUING');
  });
  it('RSV-V2-05: un boleto no emitido también se difiere con deferIssuanceFailure y sin él lanza TICKET_ISSUANCE_FAILED', async () => {
    w.ticketing.tickets = [{ status: 'FAILED' }] as never; await expect(w.book()).rejects.toThrow('TICKET_ISSUANCE_FAILED');
    const second = world(); second.ticketing.tickets = [{ status: 'FAILED' }] as never; await expect(second.book({ deferIssuanceFailure: true })).resolves.toMatchObject({ status: 'TICKET_ISSUING' });
  });
  it('RSV-V2-06: ResumePending cierra una emisión diferida y publica confirmed y ticket_issued una sola vez', async () => {
    w.ticketing.failAlways = true; const created = await w.book({ deferIssuanceFailure: true }); w.ticketing.failAlways = false;
    await expect(w.resume.execute({})).resolves.toEqual({ resumedCount: 1 });
    expect([...w.store.values.values()][0].status).toBe('CONFIRMED'); expect(w.published().map((e) => e.eventType)).toEqual(['booking.confirmed', 'booking.ticket_issued']);
    await expect(w.resume.execute({})).resolves.toEqual({ resumedCount: 0 }); expect(w.published()).toHaveLength(2); expect(created.id).toBeDefined();
  });
  it('RSV-V2-07: tres fallos de emisión terminan en FAILED con ticket_failed y luego booking.failed', async () => {
    w.ticketing.failAlways = true; await w.book({ deferIssuanceFailure: true });
    for (let i = 0; i < 3; i += 1) await w.resume.execute({});
    expect([...w.store.values.values()][0].status).toBe('FAILED'); expect(w.published().map((e) => e.eventType)).toEqual(['booking.ticket_failed', 'booking.failed']);
    expect(w.published()[1].extra).toMatchObject({ errorCode: 'TICKET_ISSUANCE_FAILED' });
  });
  it('RSV-V2-08: el fallo terminal de una reserva de v1 sigue publicando solo booking.failed', async () => {
    w.ticketing.failAlways = true; await expect(w.create.execute({ ownerId: 'owner-v1', holdId: 'hold-v1', passengers: [passenger], payment: { paymentReference: 'pay_ok_v1f' }, idempotencyKey: 'v1f' })).rejects.toThrow();
    for (let i = 0; i < 3; i += 1) await w.resume.execute({});
    expect(w.published().map((e) => e.eventType)).toEqual(['booking.failed']);
  });
  it('RSV-V2-09: pago pendiente crea PENDING_PAYMENT sin reservar nada; al aprobarse reserva asientos, consume el hold y confirma', async () => {
    w.channel.next = 'PENDING'; const created = await w.book({ passengers: [withSeat] });
    expect(created.status).toBe('PENDING_PAYMENT'); expect(w.ancillaries.seatsReserved).toBe(0); expect(w.inventory.consumed).toHaveLength(0);
    await expect(w.resume.execute({})).resolves.toEqual({ resumedCount: 0 }); expect(w.inventory.consumed).toHaveLength(0);
    w.channel.next = 'AUTHORIZED'; await expect(w.resume.execute({})).resolves.toEqual({ resumedCount: 1 });
    expect(w.ancillaries.seatsReserved).toBe(1); expect(w.inventory.consumed).toEqual(['hold']); expect(w.ancillaries.confirmed).toBe(1); expect([...w.store.values.values()][0].status).toBe('CONFIRMED');
    expect(w.channel.calls.at(-1)).toMatchObject({ channel: 'BOOKING', total: '100.00' });
  });
  it('RSV-V2-10: si el pago pendiente resulta rechazado la reserva falla, libera asientos y hold y publica booking.failed', async () => {
    w.channel.next = 'PENDING'; await w.book(); w.channel.next = new DomainError('PAYMENT_NOT_AUTHORIZED');
    await expect(w.resume.execute({})).resolves.toEqual({ resumedCount: 1 });
    expect([...w.store.values.values()][0].status).toBe('FAILED'); expect(w.pricing.releasedHolds).toEqual(['hold']); expect(w.ancillaries.released).toHaveLength(1);
    expect(w.published().map((e) => e.eventType)).toEqual(['booking.failed']); expect(w.published()[0].extra).toMatchObject({ errorCode: 'PAYMENT_NOT_AUTHORIZED' });
  });
  it('RSV-V2-11: monto distinto al reverificar también falla la reserva con AMOUNT_MISMATCH', async () => {
    w.channel.next = 'PENDING'; await w.book(); w.channel.next = new DomainError('AMOUNT_MISMATCH'); await w.resume.execute({});
    expect(w.published()[0].extra).toMatchObject({ errorCode: 'AMOUNT_MISMATCH' });
  });
  it('RSV-V2-12: Booking sin responder al reverificar no falla la reserva ni aborta el lote', async () => {
    w.channel.next = 'PENDING'; await w.book();
    w.channel.next = new Error('payment provider unavailable'); await expect(w.resume.execute({})).resolves.toEqual({ resumedCount: 0 });
    expect([...w.store.values.values()][0].status).toBe('PENDING_PAYMENT'); expect(w.published()).toHaveLength(0);
  });
  it('RSV-V2-13: si al llegar el pago ya no se pueden reservar los asientos la reserva falla con el código del dominio', async () => {
    w.channel.next = 'PENDING'; await w.book({ passengers: [withSeat] }); w.channel.next = 'AUTHORIZED'; w.ancillaries.failSeats = new DomainError('SEAT_TAKEN');
    await w.resume.execute({}); expect([...w.store.values.values()][0].status).toBe('FAILED'); expect(w.published()[0].extra).toMatchObject({ errorCode: 'SEAT_TAKEN' }); expect(w.inventory.consumed).toHaveLength(0);
  });
  it('RSV-V2-14: si el hold venció mientras el pago estaba pendiente la reserva falla con OFFER_NO_LONGER_AVAILABLE', async () => {
    w.channel.next = 'PENDING'; await w.book(); w.channel.next = 'AUTHORIZED'; w.inventory.failConsume = new Error('hold expired');
    await w.resume.execute({}); expect(w.published()[0].extra).toMatchObject({ errorCode: 'OFFER_NO_LONGER_AVAILABLE' }); expect([...w.store.values.values()][0].status).toBe('FAILED');
  });
  it('RSV-V2-15: un pago pendiente de v1 sigue su camino de siempre (sin reservar asientos ni consumir hold al reanudar)', async () => {
    await w.create.execute({ ownerId: 'owner-v1', holdId: 'hold-v1', passengers: [withSeat], payment: { paymentReference: 'pay_pending_v1' }, idempotencyKey: 'v1p' });
    w.legacy.verify = async () => 'AUTHORIZED'; await w.resume.execute({});
    expect(w.ancillaries.seatsReserved).toBe(0); expect(w.inventory.consumed).toHaveLength(0); expect([...w.store.values.values()][0].status).toBe('CONFIRMED');
  });

  it('RSV-V2-16: FailReservation (D3) anula boletos, libera asientos, capacidad y hold, marca FAILED y publica booking.failed', async () => {
    const created = await w.book(); w.events.events.length = 0;
    const result = await w.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1', reason: 'card declined' });
    expect(result.status).toBe('FAILED'); expect(w.ticketing.voided).toHaveLength(1); expect(w.ancillaries.released).toHaveLength(1); expect(w.inventory.releasedFor).toEqual([created.id]); expect(w.pricing.releasedHolds).toEqual(['hold']);
    expect(w.published()).toHaveLength(1); expect(w.published()[0]).toMatchObject({ eventType: 'booking.failed', eventId: deterministicEventId(created.id, 'booking.failed:payment') });
    expect(w.published()[0].extra).toMatchObject({ errorCode: 'PAYMENT_FAILED', failureReason: 'card declined', grandTotal: { total: '100.00' } });
  });
  it('RSV-V2-17: FailReservation es idempotente: la segunda llamada no repite compensaciones ni eventos', async () => {
    const created = await w.book(); await w.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1' }); const events = w.published().length;
    await expect(w.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1' })).resolves.toMatchObject({ status: 'FAILED' });
    expect(w.ticketing.voided).toHaveLength(1); expect(w.published()).toHaveLength(events);
  });
  it('RSV-V2-18: FailReservation sobre una reserva en PENDING_PAYMENT no anula boletos inexistentes', async () => {
    w.channel.next = 'PENDING'; const created = await w.book(); w.ticketing.tickets = [];
    await expect(w.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1' })).resolves.toMatchObject({ status: 'FAILED' }); expect(w.ticketing.voided).toHaveLength(0); expect(w.pricing.releasedHolds).toEqual(['hold']);
  });
  it('RSV-V2-19: FailReservation de otro dueño o de una reserva inexistente es NOT_FOUND', async () => {
    const created = await w.book();
    await expect(w.fail.execute({ bookingId: created.id, ownerId: 'client-b~user-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' }); await expect(w.fail.execute({ bookingId: 'nope', ownerId: 'client-a~user-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect([...w.store.values.values()][0].status).toBe('CONFIRMED');
  });
  it('RSV-V2-20: FailReservation no pisa un cambio de fecha ni una cancelación en curso', async () => {
    for (const status of ['CHANGE_PENDING', 'CANCEL_PENDING']) { const local = world(); const created = await local.book(); const stored = [...local.store.values.values()][0] as StoredReservation; stored.status = status; await expect(local.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1' })).rejects.toMatchObject({ code: 'BOOKING_NOT_CONFIRMED' }); expect(stored.status).toBe(status); }
  });
  it('RSV-V2-21: si anular los boletos falla no cambia el estado ni publica; el reintento completa la compensación', async () => {
    const created = await w.book(); w.events.events.length = 0; const original = w.ticketing.voidTickets.bind(w.ticketing); let broken = true;
    w.ticketing.voidTickets = async (input) => { if (broken) throw new Error('ticketing down'); return original(input); };
    await expect(w.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1' })).rejects.toThrow('ticketing down'); expect([...w.store.values.values()][0].status).toBe('CONFIRMED'); expect(w.published()).toHaveLength(0);
    broken = false; await expect(w.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1' })).resolves.toMatchObject({ status: 'FAILED' }); expect(w.published()).toHaveLength(1);
  });
  it('RSV-V2-22: FailReservation sobre una reserva cancelada la deja cancelada', async () => {
    const created = await w.book(); const stored = [...w.store.values.values()][0]; stored.status = 'CANCELLED';
    await expect(w.fail.execute({ bookingId: created.id, ownerId: 'client-a~user-1' })).resolves.toMatchObject({ status: 'CANCELLED' }); expect(w.ticketing.voided).toHaveLength(0);
  });

  it('RSV-V2-23: resumeOne reanuda solo la reserva indicada del dueño', async () => {
    w.channel.next = 'PENDING'; const first = await w.book(); const second = await w.book({ idempotencyKey: 'otra', payment: { paymentReference: 'PAY-2' } }); w.channel.next = 'AUTHORIZED';
    await w.resume.resumeOne({ bookingId: first.id, ownerId: 'client-a~user-1' });
    const statuses = Object.fromEntries([...w.store.values.values()].map((r) => [r.id, r.status])); expect(statuses[first.id]).toBe('CONFIRMED'); expect(statuses[second.id]).toBe('PENDING_PAYMENT');
  });
  it('RSV-V2-24: resumeOne de otro dueño es NOT_FOUND y sobre una reserva confirmada no hace nada', async () => {
    const created = await w.book(); const events = w.published().length;
    await expect(w.resume.resumeOne({ bookingId: created.id, ownerId: 'client-b~user-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await w.resume.resumeOne({ bookingId: created.id, ownerId: 'client-a~user-1' }); expect(w.published()).toHaveLength(events);
  });
  it('RSV-V2-25: la referencia de pago se usa una sola vez aunque cambie el Idempotency-Key', async () => {
    await w.book({ idempotencyKey: 'uno' }); await expect(w.book({ idempotencyKey: 'dos' })).rejects.toThrow('PAYMENT_REFERENCE_INVALID'); expect(w.channel.calls).toHaveLength(1);
  });
  it('RSV-V2-26: un rechazo del pago no crea reserva ni consume nada', async () => {
    w.channel.next = new DomainError('PAYMENT_NOT_AUTHORIZED'); await expect(w.book()).rejects.toThrow('PAYMENT_NOT_AUTHORIZED'); expect(w.store.values.size).toBe(0); expect(w.inventory.consumed).toHaveLength(0);
  });
  it('RSV-V2-27: con el proveedor de pagos caído no se crea nada', async () => {
    w.channel.next = new Error('payment provider unavailable'); await expect(w.book()).rejects.toThrow(); expect(w.store.values.size).toBe(0);
  });

  it('RSV-V2-28: eventId determinista: estable, distinto por tipo y con forma de UUID', () => {
    const a = deterministicEventId('b1', 'booking.ticket_issued'); expect(a).toBe(deterministicEventId('b1', 'booking.ticket_issued')); expect(a).not.toBe(deterministicEventId('b1', 'booking.ticket_failed')); expect(a).not.toBe(deterministicEventId('b2', 'booking.ticket_issued'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('RSV-V2-29: allocationOf extrae asientos y equipaje de los pasajeros', () => {
    const { assignments, baggage } = allocationOf([{ ...withSeat, extraBaggage: [{ itineraryId: 'it', quantity: 2 }] }]);
    expect(assignments).toEqual([{ segmentId: 'seg-1', seatNumber: '12A', passengerId: 'pax-1', passengerType: 'ADULT', cabinClass: 'ECONOMY' }]); expect(baggage).toEqual([{ itineraryId: 'it', quantity: 2, passengerId: 'pax-1' }]);
  });

  it('RSV-V2-30: RoutingPaymentVerifier usa el verificador de siempre sin canal y rechaza canales desconocidos o heredados', async () => {
    const calls: string[] = []; const fallback: PaymentVerifier = { verify: async () => { calls.push('legacy'); return 'AUTHORIZED'; }, void: async () => undefined }; const router = new RoutingPaymentVerifier(fallback, { BOOKING: new ScriptedPayment() });
    await router.verify({ paymentReference: 'x', currency: 'USD', total: '1.00' }); expect(calls).toEqual(['legacy']);
    for (const channel of ['OTRO', '__proto__', 'constructor', 'toString']) await expect(router.verify({ paymentReference: 'x', currency: 'USD', total: '1.00', channel })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('RSV-V2-31: el listado filtra por estado y por rango de creación', async () => {
    const created = await w.book(); const store = w.store; const stored = [...store.values.values()][0]; stored.changes[0] = { changedAt: '2026-10-20T10:00:00.000Z', description: 'PENDING' };
    expect((await store.list({ ownerId: 'client-a~user-1', status: 'CONFIRMED', limit: 10 })).items.map((r) => r.id)).toEqual([created.id]);
    expect((await store.list({ ownerId: 'client-a~user-1', status: 'FAILED', limit: 10 })).items).toHaveLength(0);
    expect((await store.list({ ownerId: 'client-a~user-1', createdFrom: '2026-10-21T00:00:00.000Z', limit: 10 })).items).toHaveLength(0);
    expect((await store.list({ ownerId: 'client-a~user-1', createdFrom: '2026-10-20T00:00:00.000Z', createdTo: '2026-10-20T23:59:59.000Z', limit: 10 })).items).toHaveLength(1);
  });
});
