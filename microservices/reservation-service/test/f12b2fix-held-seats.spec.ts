import { describe, expect, it } from '@jest/globals';
import { DomainError } from '@flight-platform/shared';
import { withHeldSeats } from '../src/application/allocation';
import { CreateReservation } from '../src/application/create-reservation';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

const SEG = '00000000-0000-4000-8000-000000000a01';
const adult = (passengerId: string, extra: object = {}) => ({ passengerId, passengerType: 'ADULT', birthDate: '1990-01-01', ...extra });
const infant = { passengerId: 'inf', passengerType: 'INFANT', birthDate: '2026-01-01', associatedAdultId: 'a1' };
const held = [{ segmentId: SEG, seatNumber: '12A' }, { segmentId: SEG, seatNumber: '12B' }];

describe('HELD-RSV: asientos del hold al crear la reserva', () => {
  it('HELD-RSV-01: sin asientos en la reserva se reparten en el orden de los pasajeros; el infante no ocupa asiento', () => {
    const result = withHeldSeats([adult('a1'), infant, adult('a2')], held) as Array<{ assignedSeats?: unknown[] }>;
    expect(result[0].assignedSeats).toEqual([{ segmentId: SEG, seatNumber: '12A' }]);
    expect(result[1].assignedSeats).toBeUndefined();
    expect(result[2].assignedSeats).toEqual([{ segmentId: SEG, seatNumber: '12B' }]);
  });
  it('HELD-RSV-02: asientos apartados de más: los sobrantes no se asignan; pasajeros de más: quedan sin asiento', () => {
    expect((withHeldSeats([adult('a1')], held) as Array<{ assignedSeats?: unknown[] }>)[0].assignedSeats).toEqual([{ segmentId: SEG, seatNumber: '12A' }]);
    expect((withHeldSeats([adult('a1'), adult('a2')], [held[0]]) as Array<{ assignedSeats?: unknown[] }>)[1].assignedSeats).toBeUndefined();
  });
  it('HELD-RSV-03: si la reserva trae asientos (los mismos u otros) mandan los de la reserva; sin hold con asientos no cambia nada', () => {
    const own = [adult('a1', { assignedSeats: [{ segmentId: SEG, seatNumber: '14C' }] }), adult('a2')];
    expect(withHeldSeats(own, held)).toBe(own);
    const plain = [adult('a1')]; expect(withHeldSeats(plain, [])).toBe(plain);
  });

  const setup = (seats = held, adults = 2) => {
    const pricing = new FakePricingPort(); pricing.holds.set('hold', { holdId: 'hold', ownerId: 'owner', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '100.00' }, passengersBreakdown: { adults, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId: '00000000-0000-4000-8000-000000000301', pricingOptions: [{ baggageAllowance: { checkedBaggageIncluded: 0 } }] }] });
    const ancillaries = new FakeAncillariesPort(); const reserved: unknown[] = []; const releases: unknown[] = [];
    ancillaries.getHeldSeats = async () => seats; ancillaries.reserveSeats = async (input: unknown) => { reserved.push(input); };
    const base = ancillaries.releaseAll.bind(ancillaries); ancillaries.releaseAll = async (input) => { releases.push(input); return base(input); };
    const store = new InMemoryReservationStore();
    return { service: new CreateReservation(store, pricing, new FakePaymentVerifier(), ancillaries, new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher()), store, ancillaries, reserved, releases };
  };
  const run = (service: CreateReservation, passengers: unknown[], key = 'k1', ref = 'pay_ok_1') => service.execute({ ownerId: 'owner', holdId: 'hold', passengers, payment: { paymentReference: ref }, idempotencyKey: key });

  it('HELD-RSV-04: reserva sin asientos con hold apartado: reserva los del hold por pasajero, con el holdId, y guarda los asientos en el pasajero', async () => {
    const { service, reserved, store } = setup();
    const result = await run(service, [adult('a1'), adult('a2')]);
    expect(result.status).toBe('CONFIRMED');
    expect(reserved).toEqual([expect.objectContaining({ holdId: 'hold', assignments: [expect.objectContaining({ passengerId: 'a1', seatNumber: '12A' }), expect.objectContaining({ passengerId: 'a2', seatNumber: '12B' })] })]);
    expect((([...store.values.values()][0].passengers) as Array<{ assignedSeats?: unknown[] }>)[0].assignedSeats).toEqual([{ segmentId: SEG, seatNumber: '12A' }]);
  });
  it('HELD-RSV-05: reserva con asientos propios (otros): se mandan los de la reserva con el holdId para liberar los del hold', async () => {
    const { service, reserved } = setup();
    await run(service, [adult('a1', { assignedSeats: [{ segmentId: SEG, seatNumber: '20D' }] }), adult('a2')]);
    expect(reserved).toEqual([expect.objectContaining({ holdId: 'hold', assignments: [expect.objectContaining({ passengerId: 'a1', seatNumber: '20D' })] })]);
  });
  it('HELD-RSV-06: sin asientos en el hold, la llamada es la de siempre (sin holdId ni reserveSeats)', async () => {
    const { service, reserved } = setup([]);
    await run(service, [adult('a1'), adult('a2')]);
    expect(reserved).toEqual([]);
  });
  it('HELD-RSV-07: SEAT_TAKEN al reservar: la reserva falla, se compensa devolviendo los asientos al hold y el pago se anula', async () => {
    const { service, ancillaries, releases, store } = setup();
    ancillaries.reserveSeats = async () => { throw new DomainError('SEAT_TAKEN'); };
    await expect(run(service, [adult('a1', { assignedSeats: [{ segmentId: SEG, seatNumber: '20D' }] }), adult('a2')])).rejects.toThrow('SEAT_TAKEN');
    expect(releases).toEqual([expect.objectContaining({ restoreHold: true })]);
    expect([...store.values.values()][0].status).toBe('FAILED');
  });
});
