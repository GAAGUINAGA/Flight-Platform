import { describe, expect, it } from '@jest/globals';
import { FixedClock } from '@flight-platform/shared';
import { cabinBySegment, cabinOfSegment } from '../src/application/allocation';
import { CreateReservation } from '../src/application/create-reservation';
import { ConfirmDateChange } from '../src/application/confirm-date-change';
import { ResumePending } from '../src/application/resume-pending';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

/** audit-46 H1: la cabina de cada asiento sale del tramo al que pertenece, en TODOS los caminos que mandan asientos a Ancillaries. */
const bookingId = '00000000-0000-4000-8000-000000000001'; const passengerId = '00000000-0000-4000-8000-000000000003';
const outbound = { itineraryId: 'it-out', segments: [{ segmentId: 'seg-out-1' }, { segmentId: 'seg-out-2' }], pricingOptions: [{ cabinClass: 'ECONOMY', fareBrand: 'CLASSIC', fareRules: { isChangeable: true } }] };
const inbound = { itineraryId: 'it-in', segments: [{ segmentId: 'seg-in' }], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', fareRules: { isChangeable: true } }] };

describe('cabinOfSegment: UNA regla para saber la cabina de un segmento', () => {
  it('CAB-01 ida y vuelta con cabinas distintas: cada segmento tiene la cabina de SU itinerario', () => {
    expect(cabinOfSegment([outbound, inbound], 'seg-out-1')).toBe('ECONOMY'); expect(cabinOfSegment([outbound, inbound], 'seg-in')).toBe('BUSINESS');
    expect(cabinOfSegment([inbound, outbound], 'seg-out-1')).toBe('ECONOMY'); // no depende del orden: nunca «el primero»
  });
  it('CAB-02 varios segmentos en un itinerario comparten la cabina de ese itinerario', () => {
    const cabinOf = cabinBySegment([outbound, inbound]);
    expect([cabinOf('seg-out-1'), cabinOf('seg-out-2'), cabinOf('seg-in')]).toEqual(['ECONOMY', 'ECONOMY', 'BUSINESS']);
  });
  it('CAB-03 un segmento que no está en ningún itinerario, o cuyo itinerario no tiene cabina, es un error de negocio (nunca ECONOMY por omisión)', () => {
    expect(() => cabinOfSegment([outbound, inbound], 'seg-desconocido')).toThrow('OFFER_NO_LONGER_AVAILABLE');
    expect(() => cabinOfSegment([{ segments: [{ segmentId: 's' }], pricingOptions: [{ fareBrand: 'X' }] }], 's')).toThrow('OFFER_NO_LONGER_AVAILABLE');
    expect(() => cabinOfSegment([{ segments: [{ segmentId: 's' }] }], 's')).toThrow('OFFER_NO_LONGER_AVAILABLE');
    expect(() => cabinOfSegment([], 's')).toThrow('OFFER_NO_LONGER_AVAILABLE');
  });
  it('CAB-04 con varias cabinas en el itinerario es ambiguo, salvo que `prefer` deje una sola (cambio de fecha: tarifas que permiten cambios)', () => {
    const mixed = { segments: [{ segmentId: 's' }], pricingOptions: [{ cabinClass: 'ECONOMY', fareRules: { isChangeable: false } }, { cabinClass: 'BUSINESS', fareRules: { isChangeable: true } }] };
    expect(() => cabinOfSegment([mixed], 's')).toThrow('OFFER_NO_LONGER_AVAILABLE');
    expect(cabinOfSegment([mixed], 's', (option) => option.fareRules?.isChangeable === true)).toBe('BUSINESS');
  });
  it('CAB-09 (REGLA 2) la preferencia es un FILTRO: nunca se cae a las tarifas que no la cumplen', () => {
    const changeable = (option: { fareRules?: { isChangeable?: boolean } }) => option.fareRules?.isChangeable === true;
    const cabinOf = (pricingOptions: unknown[], prefer?: typeof changeable) => cabinOfSegment([{ segments: [{ segmentId: 's' }], pricingOptions }], 's', prefer);
    // el caso exacto de audit-47: la cambiable no tiene cabina y la no cambiable sí (ECONOMY) ⇒ rechazo, no ECONOMY
    expect(() => cabinOf([{ fareRules: { isChangeable: true } }, { cabinClass: 'ECONOMY', fareRules: { isChangeable: false } }], changeable)).toThrow('OFFER_NO_LONGER_AVAILABLE');
    expect(() => cabinOf([{ cabinClass: 'ECONOMY', fareRules: { isChangeable: false } }], changeable)).toThrow('OFFER_NO_LONGER_AVAILABLE'); // ninguna cumple
    expect(() => cabinOf([], changeable)).toThrow('OFFER_NO_LONGER_AVAILABLE');
    expect(() => cabinOf([{ cabinClass: 'ECONOMY', fareRules: { isChangeable: true } }, { cabinClass: 'BUSINESS', fareRules: { isChangeable: true } }], changeable)).toThrow('OFFER_NO_LONGER_AVAILABLE'); // dos cambiables distintas
    expect(cabinOf([{ cabinClass: 'ECONOMY', fareRules: { isChangeable: false } }, { cabinClass: 'BUSINESS', fareRules: { isChangeable: true } }], changeable)).toBe('BUSINESS'); // una cambiable con cabina
    expect(cabinOf([{ cabinClass: 'BUSINESS', fareRules: { isChangeable: true } }, { cabinClass: 'BUSINESS', fareRules: { isChangeable: true } }], changeable)).toBe('BUSINESS'); // dos iguales
    // sin prefer, como siempre: una cabina única entre las tarifas; varias distintas ⇒ rechazo
    expect(cabinOf([{ cabinClass: 'FIRST' }])).toBe('FIRST'); expect(() => cabinOf([{ cabinClass: 'ECONOMY' }, { cabinClass: 'BUSINESS' }])).toThrow('OFFER_NO_LONGER_AVAILABLE');
  });
});

const seg = (id: string, from: string, to: string) => ({ segmentId: id, flightInstanceId: `fi-${id}`, departure: { iataCode: from, at: '2026-10-25T12:00:00.000Z' }, arrival: { iataCode: to, at: '2026-10-25T13:30:00.000Z' } });
const roundTrip = () => [
  { itineraryId: 'it-out', segments: [seg('seg-out', 'UIO', 'GPS')], pricingOptions: [{ cabinClass: 'ECONOMY', fareBrand: 'CLASSIC', fareRules: { isChangeable: true } }] },
  { itineraryId: 'it-in', segments: [seg('seg-in', 'GPS', 'UIO')], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', fareRules: { isChangeable: true } }] }
];

class SpyPayment extends FakePaymentVerifier { readonly verified: string[] = []; override async verify(input: { paymentReference: string; currency: string; total: string }) { this.verified.push(input.paymentReference); return super.verify(input); } }
type Options = { failSeats?: boolean; amount?: string; failHold?: boolean };
const setup = async (replacement: ReturnType<typeof seg>, { failSeats = false, amount = '0.00', failHold = false }: Options = {}) => {
  const store = new InMemoryReservationStore();
  await store.create({ id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'old-hold', paymentReference: 'pay_ok_initial', idempotencyKey: 'create-key', passengers: [{ passengerId, passengerType: 'ADULT' }], itineraries: roundTrip(), grandTotal: { currency: 'USD', total: '500.00' }, changes: [], attempts: 0 });
  const pricing = new FakePricingPort(); pricing.getChangeOffer = async () => ({ changeOfferId: 'offer-1', expiresAt: '2026-10-17T00:15:00.000Z', segments: [replacement], priceDifference: { totalToPay: amount } }); pricing.markChangeOfferUsed = async () => undefined;
  const inventory = new FakeInventoryPort(); const holds: Array<{ segments: Array<{ flightInstanceId: string; cabinClass: string }> }> = [];
  const released: string[] = []; inventory.releaseHold = async (input) => { released.push(input.holdId); };
  inventory.createHold = async (input) => { if (failHold) throw new Error('dependency details'); holds.push(input); return { holdId: 'new-hold' }; }; inventory.consumeHold = async () => undefined; inventory.releaseReservedInventory = async () => undefined;
  const ancillaries = new FakeAncillariesPort(); const reserved: Array<Record<string, unknown>> = []; let fail = failSeats;
  ancillaries.reserveSeats = async (input: { assignments: Array<Record<string, unknown>> }) => { if (fail) throw new Error('dependency details'); reserved.push(...input.assignments); };
  const tickets = new FakeTicketingPort(); tickets.reissueTickets = async () => [{ status: 'ISSUED' }];
  const events = new FakeEventPublisher(); const payment = new SpyPayment();
  const service = new ConfirmDateChange(store, pricing, payment, inventory, ancillaries, tickets, events, new FixedClock(new Date('2026-10-17T00:00:00.000Z')), 20);
  return { service, store, holds, released, payment, reserved, ancillaries, tickets, events, inventory, heal: () => { fail = false; } };
};

describe('cambio de fecha: la cabina de cada asiento y del hold es la del tramo cambiado', () => {
  it('CAB-05 cambiar el SEGUNDO itinerario (BUSINESS) con un asiento en ese tramo: el hold y el asiento van en BUSINESS, no en la cabina del primero (ECONOMY)', async () => {
    const test = await setup(seg('seg-in-2', 'GPS', 'UIO'));
    const result = await test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', assignedSeats: [{ segmentId: 'seg-in-2', seatNumber: '2A' }], idempotencyKey: '00000000-0000-4000-8000-000000000006' });
    expect(result.status).toBe('CONFIRMED');
    expect(test.holds).toHaveLength(1); expect(test.holds[0].segments).toEqual([expect.objectContaining({ flightInstanceId: 'fi-seg-in-2', cabinClass: 'BUSINESS' })]);
    expect(test.reserved).toEqual([expect.objectContaining({ segmentId: 'seg-in-2', seatNumber: '2A', cabinClass: 'BUSINESS' })]);
  });
  it('CAB-06 cambiar el PRIMER itinerario (ECONOMY) con la vuelta en BUSINESS: el asiento de la ida va en ECONOMY', async () => {
    const test = await setup(seg('seg-out-2', 'UIO', 'GPS'));
    await test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', assignedSeats: [{ segmentId: 'seg-out-2', seatNumber: '14C' }], idempotencyKey: '00000000-0000-4000-8000-000000000007' });
    expect(test.holds[0].segments).toEqual([expect.objectContaining({ cabinClass: 'ECONOMY' })]);
    expect(test.reserved).toEqual([expect.objectContaining({ segmentId: 'seg-out-2', cabinClass: 'ECONOMY' })]);
  });
  for (const amount of ['0.00', '25.00']) {
    it(`CAB-07 (importe ${amount}) un asiento en un segmento que no es de la reserva se rechaza ANTES de cualquier efecto: pago ni reclamado ni verificado, sin hold, reserva intacta; y la MISMA referencia sirve después en un cambio válido`, async () => {
      const test = await setup(seg('seg-in-2', 'GPS', 'UIO'), { amount });
      await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_change' }, assignedSeats: [{ segmentId: 'seg-ajeno', seatNumber: '2A' }], idempotencyKey: '00000000-0000-4000-8000-000000000008' })).rejects.toMatchObject({ code: 'OFFER_NO_LONGER_AVAILABLE' });
      expect(test.holds).toEqual([]); expect(test.reserved).toEqual([]); expect(test.payment.verified).toEqual([]); expect(test.payment.voided).toEqual([]);
      expect(test.store.paymentReferences.size).toBe(0);
      expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CONFIRMED', holdId: 'old-hold', grandTotal: { total: '500.00' } });
      const retry = await test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_change' }, assignedSeats: [{ segmentId: 'seg-in-2', seatNumber: '2A' }], idempotencyKey: '00000000-0000-4000-8000-000000000018' });
      expect(retry.status).toBe('CONFIRMED'); expect(test.payment.verified).toEqual(amount === '0.00' ? [] : ['pay_ok_change']);
    });
  }
  it('CAB-07b más asientos que pasajeros con asiento, o sin referencia de pago con importe a pagar: también se rechaza antes de cualquier efecto', async () => {
    const test = await setup(seg('seg-in-2', 'GPS', 'UIO'), { amount: '25.00' });
    await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_x' }, assignedSeats: [{ segmentId: 'seg-in-2', seatNumber: '2A' }, { segmentId: 'seg-in-2', seatNumber: '2C' }], idempotencyKey: '00000000-0000-4000-8000-000000000019' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000020' })).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_INVALID' });
    expect(test.payment.verified).toEqual([]); expect(test.holds).toEqual([]); expect(test.store.paymentReferences.size).toBe(0);
  });
  it('CAB-10 un fallo DESPUÉS del pago y ANTES de persistir el cambio (Inventory no crea el hold) anula el pago, libera la referencia y devuelve el error ORIGINAL; la reserva queda intacta', async () => {
    const test = await setup(seg('seg-in-2', 'GPS', 'UIO'), { amount: '25.00', failHold: true });
    await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_change' }, assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000021' })).rejects.toThrow('dependency details');
    expect(test.payment.verified).toEqual(['pay_ok_change']); expect(test.payment.voided).toEqual(['pay_ok_change']);
    expect(test.store.paymentReferences.size).toBe(0);
    expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CONFIRMED', holdId: 'old-hold', grandTotal: { total: '500.00' } });
  });
  it('CAB-11 un fallo al persistir CHANGE_PENDING (después de crear el hold) libera el hold, anula el pago, libera la referencia y devuelve el error original', async () => {
    const test = await setup(seg('seg-in-2', 'GPS', 'UIO'), { amount: '25.00' });
    const update = test.store.update.bind(test.store); let first = true;
    test.store.update = async (value) => { if (first) { first = false; throw new Error('database details'); } return update(value); };
    await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_change' }, assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000022' })).rejects.toThrow('database details');
    expect(test.released).toEqual(['new-hold']); expect(test.payment.voided).toEqual(['pay_ok_change']); expect(test.store.paymentReferences.size).toBe(0);
    expect(await test.store.findById('owner', bookingId)).toMatchObject({ status: 'CONFIRMED', holdId: 'old-hold', grandTotal: { total: '500.00' } });
  });
  it('CAB-12 pago no autorizado (PENDING): no cambia nada y la referencia reclamada se libera', async () => {
    const test = await setup(seg('seg-in-2', 'GPS', 'UIO'), { amount: '25.00' });
    await expect(test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_pending_change' }, assignedSeats: [], idempotencyKey: '00000000-0000-4000-8000-000000000023' })).rejects.toMatchObject({ code: 'PAYMENT_NOT_AUTHORIZED' });
    expect(test.holds).toEqual([]); expect(test.store.paymentReferences.size).toBe(0);
  });
  it('CAB-13 un fallo en Ancillaries cuando el cambio YA está persistido (CHANGE_PENDING, inventario anterior liberado) no deshace el pago: la reserva queda reanudable y ResumePending la completa', async () => {
    const test = await setup(seg('seg-in-2', 'GPS', 'UIO'), { amount: '25.00', failSeats: true });
    const pending = await test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', payment: { paymentReference: 'pay_ok_change' }, assignedSeats: [{ segmentId: 'seg-in-2', seatNumber: '2A' }], idempotencyKey: '00000000-0000-4000-8000-000000000024' });
    expect(pending.status).toBe('CHANGE_PENDING'); expect(test.payment.voided).toEqual([]); expect(test.released).toEqual([]);
    test.heal();
    const resume = new ResumePending(test.store, new FakePaymentVerifier(), test.events, test.ancillaries, test.inventory, test.tickets);
    await expect(resume.execute({})).resolves.toEqual({ resumedCount: 1 });
    expect((await test.store.findById('owner', bookingId))?.status).toBe('CONFIRMED');
  });
  it('CAB-08 el reintento (ResumePending) repite la cabina del tramo cambiado, no la del primer itinerario', async () => {
    const test = await setup(seg('seg-in-2', 'GPS', 'UIO'), { failSeats: true });
    const pending = await test.service.execute({ bookingId, ownerId: 'owner', changeOfferId: 'offer-1', assignedSeats: [{ segmentId: 'seg-in-2', seatNumber: '2A' }], idempotencyKey: '00000000-0000-4000-8000-000000000009' });
    expect(pending.status).toBe('CHANGE_PENDING'); expect(test.reserved).toEqual([]);
    test.heal();
    const resume = new ResumePending(test.store, new FakePaymentVerifier(), test.events, test.ancillaries, test.inventory, test.tickets);
    await expect(resume.execute({})).resolves.toEqual({ resumedCount: 1 });
    expect(test.reserved).toEqual([expect.objectContaining({ segmentId: 'seg-in-2', seatNumber: '2A', cabinClass: 'BUSINESS' })]);
    expect((await test.store.findById('owner', bookingId))?.status).toBe('CONFIRMED');
  });
});

describe('crear la reserva: la cabina de cada asiento se valida ANTES de verificar el pago (REGLA 1)', () => {
  it('CAB-14 un asiento apartado en un tramo que no es de la reserva se rechaza sin verificar el pago ni insertar la reserva', async () => {
    const pricing = new FakePricingPort();
    pricing.holds.set('hold', { holdId: 'hold', ownerId: 'owner', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '420.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId: 'it-1', segments: [{ segmentId: 'seg-1' }], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', baggageAllowance: { checkedBaggageIncluded: 2 } }] }] } as never);
    const ancillaries = new FakeAncillariesPort(); ancillaries.getHeldSeats = async () => [{ segmentId: 'seg-ajeno', seatNumber: '2A' }];
    const payment = new SpyPayment(); const store = new InMemoryReservationStore();
    const service = new CreateReservation(store, pricing, payment, ancillaries, new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher());
    await expect(service.execute({ ownerId: 'owner', holdId: 'hold', passengers: [{ passengerId, passengerType: 'ADULT', birthDate: '1990-01-01' }], payment: { paymentReference: 'pay_ok_biz' }, idempotencyKey: 'key-14' })).rejects.toMatchObject({ code: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(payment.verified).toEqual([]); expect(payment.voided).toEqual([]); expect(store.values.size).toBe(0);
  });
});
