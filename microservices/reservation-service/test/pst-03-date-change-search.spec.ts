import { expect, it } from '@jest/globals';
import { SearchDateChange } from '../src/application/post-sale-date-change';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakePricingPort } from '../src/infrastructure/clients/fakes';
import { createResponseValidator } from '../src/infrastructure/grpc/openapi-response-validator';

const bookingId = '00000000-0000-4000-8000-000000000001';
const itineraryId = '00000000-0000-4000-8000-000000000002';
const segment = { segmentId: 'seg-new', flightNumber: 'FP123', departure: { iataCode: 'BOG', at: '2026-10-20T12:00:00.000Z' }, arrival: { iataCode: 'MDE', at: '2026-10-20T13:00:00.000Z' }, marketingCarrier: 'FP', operatingCarrier: 'FP' };

it('PST-03 / K: devuelve ofertas de cambio validadas con el schema OpenAPI', async () => {
  const reservations = new InMemoryReservationStore();
  await reservations.create({ id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'hold', paymentReference: 'payment', idempotencyKey: 'create', passengers: [{ passengerType: 'ADULT' }], itineraries: [{ itineraryId, segments: [{ departure: { at: '2026-10-25T12:00:00.000Z' } }], pricingOptions: [{ fareRules: { isChangeable: true } }] }], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0 });
  const pricing = new FakePricingPort();
  pricing.quoteChange = async () => ({ offers: [{ changeOfferId: 'offer-1', expiresAt: '2026-10-17T00:15:00.000Z', segments: [segment], priceDifference: { fareDifference: '10.00', taxDifference: '0.00', changeFee: '15.00', totalToPay: '25.00' } }] });
  const service = new SearchDateChange(reservations, pricing, () => new Date('2026-10-17T00:00:00.000Z'), createResponseValidator());
  const result = await service.execute({ bookingId, ownerId: 'owner', changes: [{ itineraryId, newDepartureDate: '2026-10-20' }] });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ changeOfferId: 'offer-1', segments: [segment] });
});

it('PST-03 / S: tarifa no cambiable responde FARE_NOT_CHANGEABLE antes de Pricing', async () => {
  const reservations = new InMemoryReservationStore();
  await reservations.create({ id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'hold', paymentReference: 'payment', idempotencyKey: 'create', passengers: [{ passengerType: 'ADULT' }], itineraries: [{ itineraryId, segments: [{ departure: { at: '2026-10-25T12:00:00.000Z' } }], pricingOptions: [{ fareBrand: 'BASIC', fareRules: { isChangeable: false } }] }], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0 });
  const pricing = new FakePricingPort(); let called = false;
  pricing.quoteChange = async () => { called = true; return { offers: [] }; };
  const service = new SearchDateChange(reservations, pricing, () => new Date('2026-10-17T00:00:00.000Z'), createResponseValidator());
  await expect(service.execute({ bookingId, ownerId: 'owner', changes: [{ itineraryId, newDepartureDate: '2026-10-20' }] })).rejects.toMatchObject({ code: 'FARE_NOT_CHANGEABLE' });
  expect(called).toBe(false);
});

it('PST-03 / S: reserva de otro owner no se consulta en Pricing', async () => {
  const reservations = new InMemoryReservationStore();
  const pricing = new FakePricingPort(); let called = false;
  pricing.quoteChange = async () => { called = true; return { offers: [] }; };
  const service = new SearchDateChange(reservations, pricing, () => new Date('2026-10-17T00:00:00.000Z'), createResponseValidator());
  await expect(service.execute({ bookingId, ownerId: 'other', changes: [{ itineraryId, newDepartureDate: '2026-10-20' }] })).rejects.toThrow('NOT_FOUND');
  expect(called).toBe(false);
});
