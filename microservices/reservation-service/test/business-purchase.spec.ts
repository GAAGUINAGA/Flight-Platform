import { expect, it } from '@jest/globals';
import { CreateReservation } from '../src/application/create-reservation';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';

/** Reproduce el fallo de la compra en BUSINESS: los asientos que Reservation manda a Ancillaries deben llevar la cabina COMPRADA, no una fija. */
const passenger = { passengerId: '00000000-0000-4000-8000-000000000002', passengerType: 'ADULT', birthDate: '1990-01-01' };
const itineraryId = '00000000-0000-4000-8000-000000000003'; const segmentId = '00000000-0000-4000-8000-000000000004';
const returnItineraryId = '00000000-0000-4000-8000-000000000005'; const returnSegmentId = '00000000-0000-4000-8000-000000000006';

const purchase = async (itineraries: unknown[], held: Array<{ segmentId: string; seatNumber: string }>) => {
  const pricing = new FakePricingPort();
  pricing.holds.set('hold', { holdId: 'hold', ownerId: 'owner', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '420.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries } as never);
  const ancillaries = new FakeAncillariesPort(); const sent: Array<Record<string, unknown>> = [];
  ancillaries.getHeldSeats = async () => held;
  ancillaries.reserveSeats = async (value: { assignments: Array<Record<string, unknown>> }) => { sent.push(...value.assignments); };
  const service = new CreateReservation(new InMemoryReservationStore(), pricing, new FakePaymentVerifier(), ancillaries, new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher());
  await service.execute({ ownerId: 'owner', holdId: 'hold', passengers: [passenger], payment: { paymentReference: 'pay_ok_biz' }, idempotencyKey: 'key-biz' });
  return sent;
};

it('BIZ-01: comprar BUSINESS (FLEX, 2 maletas incluidas) con el asiento apartado en el hold reserva el asiento con cabinClass BUSINESS', async () => {
  const sent = await purchase([{ itineraryId, segments: [{ segmentId }], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', baggageAllowance: { checkedBaggageIncluded: 2 } }] }], [{ segmentId, seatNumber: '2A' }]);
  expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ seatNumber: '2A', cabinClass: 'BUSINESS' });
});

for (const cabinClass of ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']) {
  it(`BIZ-02: ${cabinClass} (como el B787 de largo recorrido) reserva el asiento apartado con su propia cabina`, async () => {
    const sent = await purchase([{ itineraryId, segments: [{ segmentId }], pricingOptions: [{ cabinClass, fareBrand: 'FLEX', baggageAllowance: { checkedBaggageIncluded: 2 } }] }], [{ segmentId, seatNumber: '3A' }]);
    expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ seatNumber: '3A', cabinClass });
  });
}

it('BIZ-03: ida en BUSINESS y vuelta en ECONOMY: cada asiento lleva la cabina de SU segmento', async () => {
  const sent = await purchase([
    { itineraryId, segments: [{ segmentId }], pricingOptions: [{ cabinClass: 'BUSINESS', fareBrand: 'FLEX', baggageAllowance: { checkedBaggageIncluded: 2 } }] },
    { itineraryId: returnItineraryId, segments: [{ segmentId: returnSegmentId }], pricingOptions: [{ cabinClass: 'ECONOMY', fareBrand: 'CLASSIC', baggageAllowance: { checkedBaggageIncluded: 1 } }] }
  ], [{ segmentId, seatNumber: '2A' }, { segmentId: returnSegmentId, seatNumber: '14C' }]);
  expect(sent).toEqual(expect.arrayContaining([expect.objectContaining({ segmentId, cabinClass: 'BUSINESS' }), expect.objectContaining({ segmentId: returnSegmentId, cabinClass: 'ECONOMY' })]));
});
