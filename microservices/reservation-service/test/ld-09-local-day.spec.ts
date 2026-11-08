import { describe, expect, it } from '@jest/globals';
import { SearchDateChange } from '../src/application/post-sale-date-change';
import { ReservationQueries } from '../src/application/queries';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { FakePricingPort } from '../src/infrastructure/clients/fakes';
import { createResponseValidator } from '../src/infrastructure/grpc/openapi-response-validator';

// NFR-TI-01 / ADR-F12b1fix-02 (LD-09): reservation usa la fecha local del aeropuerto de origen.
const bookingId = '00000000-0000-4000-8000-000000000001';
const itineraryId = '00000000-0000-4000-8000-000000000002';

const seed = async (origin: string, at: string) => {
  const store = new InMemoryReservationStore();
  await store.create({ id: bookingId, ownerId: 'owner', pnr: 'ABC123', status: 'CONFIRMED', holdId: 'hold', paymentReference: 'payment', idempotencyKey: 'create', passengers: [{ passengerType: 'ADULT' }], itineraries: [{ itineraryId, segments: [{ departure: { iataCode: origin, at }, arrival: { iataCode: 'MAD', at } }], pricingOptions: [{ fareRules: { isChangeable: true } }] }], grandTotal: { currency: 'USD', total: '100.00' }, changes: [], attempts: 0 });
  return store;
};

describe('LD-09 reservation', () => {
  it('el resumen muestra la fecha local de salida: LIM 22:30 locales (03:30Z del día siguiente) y la salida 01:30Z del seed', async () => {
    const lima = new ReservationQueries(await seed('LIM', '2030-06-11T03:30:00.000Z'));
    expect((await lima.list({ ownerId: 'owner' })).items[0].departureDate).toBe('2030-06-10');
    const seedLike = new ReservationQueries(await seed('LIM', '2030-06-14T01:30:00.000Z'));
    expect((await seedLike.list({ ownerId: 'owner' })).items[0].departureDate).toBe('2030-06-13');
    const quito = new ReservationQueries(await seed('UIO', '2030-06-11T00:00:00.000Z'));
    expect((await quito.list({ ownerId: 'owner' })).items[0].departureDate).toBe('2030-06-10');
  });

  it('un origen sin zona se lee en UTC', async () => {
    const queries = new ReservationQueries(await seed('QQQ', '2030-06-11T03:30:00.000Z'));
    expect((await queries.list({ ownerId: 'owner' })).items[0].departureDate).toBe('2030-06-11');
  });

  it('el cambio de fecha exige una fecha posterior al día LOCAL de hoy en el origen', async () => {
    const attempt = async (now: string, newDepartureDate: string) => {
      const pricing = new FakePricingPort(); let called = false;
      pricing.quoteChange = async () => { called = true; return { offers: [] }; };
      const service = new SearchDateChange(await seed('BOG', '2030-06-20T12:00:00.000Z'), pricing, () => new Date(now), createResponseValidator());
      const outcome = await service.execute({ bookingId, ownerId: 'owner', changes: [{ itineraryId, newDepartureDate }] }).then(() => 'ok', (error: { code?: string }) => error.code ?? 'error');
      return { outcome, called };
    };
    // 2030-06-17T03:00Z = 22:00 del 16 en Bogotá: el 17 aún es futuro (con la regla UTC se rechazaba).
    expect(await attempt('2030-06-17T03:00:00.000Z', '2030-06-17')).toEqual({ outcome: 'ok', called: true });
    expect(await attempt('2030-06-17T03:00:00.000Z', '2030-06-16')).toEqual({ outcome: 'VALIDATION_FAILED', called: false });
    // 2030-06-17T06:00Z = 01:00 del 17 en Bogotá: el 17 ya es hoy.
    expect(await attempt('2030-06-17T06:00:00.000Z', '2030-06-17')).toEqual({ outcome: 'VALIDATION_FAILED', called: false });
    expect(await attempt('2030-06-17T06:00:00.000Z', '2030-06-18')).toEqual({ outcome: 'ok', called: true });
  });
});
