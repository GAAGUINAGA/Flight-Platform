import { expect, it } from '@jest/globals';
import { of } from 'rxjs';
import { CreateReservation } from '../src/application/create-reservation';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../src/infrastructure/clients/fakes';
import { GrpcPricingGateway } from '../src/infrastructure/clients/grpc-gateways';

const passenger = { passengerId: '00000000-0000-4000-8000-000000000002', passengerType: 'ADULT', birthDate: '1990-01-01' };
const itineraryId = '00000000-0000-4000-8000-000000000003';
it('F9-0 / U: el adaptador conserva la tarifa seleccionada en GetPriceLock', async () => {
  const basic = { cabinClass: 'ECONOMY', fareBrand: 'BASIC', baggageAllowance: { checkedBaggageIncluded: 0 } };
  const classic = { cabinClass: 'ECONOMY', fareBrand: 'CLASSIC', baggageAllowance: { checkedBaggageIncluded: 2 } };
  const service = new GrpcPricingGateway(() => ({ getOfferHold: () => of({ status: 'HELD', expiresAt: '2099-01-01', lockedPrice: { currency: 'USD', total: '100.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId, pricingOptions: [basic, classic] }] }), getPriceLock: () => of({ selections: [{ itineraryId, cabinClass: 'ECONOMY', fareBrand: 'CLASSIC' }] }) }));
  const hold = await service.getHold({ holdId: 'hold', ownerId: 'owner' });
  expect(hold.itineraries).toEqual([{ itineraryId, pricingOptions: [classic] }]);
});
it('F9-0 / U: incluso con pago pendiente se registra la franquicia de la tarifa adquirida', async () => {
  const pricing = new FakePricingPort();
  pricing.holds.set('hold', { holdId: 'hold', ownerId: 'owner', status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '100.00' }, passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId, pricingOptions: [{ baggageAllowance: { checkedBaggageIncluded: 2 } }] }] });
  const ancillaries = new FakeAncillariesPort();
  const recorded: unknown[] = [];
  ancillaries.registerBaggageAllowance = async (value) => { recorded.push(value); };
  const service = new CreateReservation(new InMemoryReservationStore(), pricing, new FakePaymentVerifier(), ancillaries, new FakeInventoryPort(), new FakeTicketingPort(), new FakeEventPublisher());
  const created = await service.execute({ ownerId: 'owner', holdId: 'hold', passengers: [passenger], payment: { paymentReference: 'pay_pending_test' }, idempotencyKey: 'key' });
  expect(created.status).toBe('PENDING_PAYMENT');
  expect(recorded).toEqual([{ bookingId: created.id, ownerId: 'owner', allowances: [{ passengerId: passenger.passengerId, itineraryId, checkedBaggageIncluded: 2 }] }]);
});
