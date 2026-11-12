import { describe, expect, it } from '@jest/globals';
import { DomainError, safeGrpcError } from '@flight-platform/shared';
import { CreateReservation, CreateReservationInput } from '../src/application/create-reservation';
import { PaymentResult, PaymentVerifier } from '../src/application/ports';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

// ADR-F12c-03: Reservation aplica los topes del canal WEB al insertar (almacén en memoria; la carrera real contra Postgres está en test/integration/f12c-web-limits-postgres.spec.ts).
class VoidSpy implements PaymentVerifier { voided: string[] = []; async verify(): Promise<PaymentResult> { return 'AUTHORIZED'; } async void(input: { paymentReference: string }): Promise<void> { this.voided.push(input.paymentReference); } }
const OWNER = 'user-1'; let n = 0;
const build = (ownerId = OWNER) => {
  const pricing = new FakePricingPort(); const store = new InMemoryReservationStore(); const payment = new VoidSpy();
  const create = new CreateReservation(store, pricing, payment, new FakeAncillariesPort(), new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher());
  const book = (extra: Partial<CreateReservationInput> = {}, pax = 1, owner = ownerId) => {
    n += 1; const holdId = `hold-${n}`;
    pricing.holds.set(holdId, { holdId, ownerId: owner, status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '1.00' }, passengersBreakdown: { adults: pax, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId: '00000000-0000-4000-8000-000000000301', pricingOptions: [{ baggageAllowance: { checkedBaggageIncluded: 0 } }] }] });
    return create.execute({ ownerId: owner, holdId, passengers: Array.from({ length: pax }, (_, i) => ({ passengerId: `p-${n}-${i}`, passengerType: 'ADULT', birthDate: '1990-01-01' })), payment: { paymentReference: `pay_ok_${n}` }, idempotencyKey: `key-${n}`, paymentChannel: 'WEB', webMaxActiveBookings: 2, webMaxPassengersPerDay: 3, ...extra });
  };
  return { store, payment, book };
};
const codeOf = async (promise: Promise<unknown>) => promise.then(() => 'OK', (error: unknown) => (error as DomainError).code);

describe('F12c: topes del canal WEB en Reservation', () => {
  it('RSV-WEBLIM-U1: reservas activas por dueño: la tercera se rechaza con WEB_ACTIVE_LIMIT_EXCEEDED y el pago verificado se anula', async () => {
    const { book, payment, store } = build(); await book(); await book();
    expect(await codeOf(book())).toBe('WEB_ACTIVE_LIMIT_EXCEEDED'); expect(store.values.size).toBe(2); expect(payment.voided).toEqual([`pay_ok_${n}`]);
  });
  it('RSV-WEBLIM-U2: la cancelada libera su lugar en activas pero sigue contando en pasajeros del día; la FAILED no cuenta', async () => {
    const { book, store } = build(); const first = await book(); await book();
    await store.update({ ...first, status: 'CANCELLED' }); await expect(book()).resolves.toBeDefined(); // activas: 2 de nuevo; día: 3 pasajeros
    const [, second] = [...store.values.values()]; await store.update({ ...second, status: 'FAILED' }); // una FAILED no cuenta en el día
    expect(await codeOf(book())).toBe('OK'); // día: A (cancelada) + C + D = 3 (la FAILED no suma) → cabe
    const [, , third] = [...store.values.values()]; await store.update({ ...third, status: 'CANCELLED' }); // hay lugar en activas, pero el día ya suma 3
    expect(await codeOf(book())).toBe('WEB_PASSENGERS_LIMIT_EXCEEDED');
  });
  it('RSV-WEBLIM-U3: el tope es por dueño y el canal BOOKING (o sin topes) no tiene ninguno', async () => {
    const { book } = build(); await book(); await book();
    await expect(book({}, 1, 'user-2')).resolves.toBeDefined();
    for (let i = 0; i < 4; i += 1) await expect(book({ paymentChannel: 'BOOKING', webMaxActiveBookings: undefined, webMaxPassengersPerDay: undefined })).resolves.toBeDefined();
    expect(await codeOf(book({ webMaxActiveBookings: undefined, webMaxPassengersPerDay: undefined }))).toBe('VALIDATION_FAILED'); // WEB sin topes: falla cerrado (audit-22)
  });
  it('RSV-WEBLIM-U4: idempotencia: reintentar la misma Idempotency-Key (respuesta perdida) devuelve la reserva existente sin crear otra ni chocar con el tope', async () => {
    const { book, store } = build(); await book();
    const input: Partial<CreateReservationInput> = { idempotencyKey: 'misma-clave', payment: { paymentReference: 'pay_ok_idem' } };
    const first = await book(input); const again = await book(input);
    expect(again.id).toBe(first.id); expect(store.values.size).toBe(2);
  });
  it('RSV-WEBLIM-U5: los códigos internos viajan por gRPC como RESOURCE_EXHAUSTED con su propio detalle', () => {
    expect(safeGrpcError(new DomainError('WEB_ACTIVE_LIMIT_EXCEEDED'))).toEqual({ code: 8, details: 'WEB_ACTIVE_LIMIT_EXCEEDED' });
    expect(safeGrpcError(new DomainError('WEB_PASSENGERS_LIMIT_EXCEEDED'))).toEqual({ code: 8, details: 'WEB_PASSENGERS_LIMIT_EXCEEDED' });
  });
  it('RSV-WEBLIM-U7: WEB sin topes, con uno solo o con valores cero, negativos, decimales o no numericos => VALIDATION_FAILED sin insertar ni tocar el pago (falla cerrado)', async () => {
    const { book, payment, store } = build(); let verifies = 0; const verify = payment.verify.bind(payment); payment.verify = async () => { verifies += 1; return verify(); };
    const cases: Array<Partial<CreateReservationInput>> = [
      { webMaxActiveBookings: undefined, webMaxPassengersPerDay: undefined }, { webMaxPassengersPerDay: undefined }, { webMaxActiveBookings: undefined },
      { webMaxActiveBookings: 0 }, { webMaxPassengersPerDay: 0 }, { webMaxActiveBookings: -1 }, { webMaxPassengersPerDay: -5 }, { webMaxActiveBookings: 1.5 },
      { webMaxActiveBookings: Number.NaN }, { webMaxPassengersPerDay: Number.POSITIVE_INFINITY }, { webMaxActiveBookings: '2' as never }, { webMaxPassengersPerDay: null as never }
    ];
    for (const extra of cases) expect(await codeOf(book(extra))).toBe('VALIDATION_FAILED');
    expect(store.values.size).toBe(0); expect(verifies).toBe(0); expect(payment.voided).toEqual([]);
  });
  it('RSV-WEBLIM-U8: BOOKING sin topes sigue funcionando; un reintento idempotente WEB sin topes tampoco devuelve ni crea nada', async () => {
    const { book, store } = build(); await expect(book({ paymentChannel: 'BOOKING', webMaxActiveBookings: undefined, webMaxPassengersPerDay: undefined })).resolves.toBeDefined();
    const first = await book({ idempotencyKey: 'k-idem' }); expect(first).toBeDefined(); expect(store.values.size).toBe(2);
    expect(await codeOf(book({ idempotencyKey: 'k-idem', webMaxActiveBookings: undefined, webMaxPassengersPerDay: undefined }))).toBe('VALIDATION_FAILED'); expect(store.values.size).toBe(2);
  });
  it('RSV-WEBLIM-U6: sin verificador especial la reserva WEB normal sigue funcionando con el verificador simulado', async () => {
    const pricing = new FakePricingPort(); pricing.holds.set('h', { holdId: 'h', ownerId: OWNER, status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '1.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId: '00000000-0000-4000-8000-000000000301', pricingOptions: [{ baggageAllowance: { checkedBaggageIncluded: 0 } }] }] });
    const create = new CreateReservation(new InMemoryReservationStore(), pricing, new FakePaymentVerifier(), new FakeAncillariesPort(), new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher());
    await expect(create.execute({ ownerId: OWNER, holdId: 'h', passengers: [{ passengerId: 'p', passengerType: 'ADULT', birthDate: '1990-01-01' }], payment: { paymentReference: 'pay_ok_x' }, idempotencyKey: 'k', paymentChannel: 'WEB', webMaxActiveBookings: 1, webMaxPassengersPerDay: 1 })).resolves.toMatchObject({ paymentChannel: 'WEB' });
  });
});
