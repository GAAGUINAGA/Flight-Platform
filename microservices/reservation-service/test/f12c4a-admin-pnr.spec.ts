import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { InternalKeyInterceptor } from '@flight-platform/shared';
import { of } from 'rxjs';
import { Metadata } from '@grpc/grpc-js';
import { adminBookingView, partnerRef } from '../src/application/admin-view';
import { ReservationQueries } from '../src/application/queries';
import { InMemoryReservationStore, StoredReservation } from '../src/application/reservation-store';
import { ReservationController } from '../src/infrastructure/grpc/reservation.controller';

/** F12c-4a (ADR-F12c4-01): AdminGetReservationByPnr. Solo lectura, cualquier canal, sin datos personales. */
const KEY = 'k'.repeat(32);
const SEGMENT = randomUUID(); const ITINERARY = randomUUID();
const passenger = { passengerId: 'pax-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Pérez', documentType: 'PASSPORT', documentNumber: 'AB1234567', nationality: 'EC', documentExpiryDate: '2030-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'ana@example.com', phone: '+593990000000' }, assignedSeats: [], extraBaggage: [] };
const itinerary = { itineraryId: ITINERARY, segments: [{ segmentId: SEGMENT, flightInstanceId: randomUUID(), flightNumber: 'FP210', departure: { iataCode: 'UIO', at: '2026-11-15T15:00:00.000Z' }, arrival: { iataCode: 'GPS', at: '2026-11-15T17:00:00.000Z' }, status: 'SCHEDULED' }], pricingOptions: [{ cabinClass: 'ECONOMY' }] };
const stored = (overrides: Partial<StoredReservation>): StoredReservation => ({ id: randomUUID(), ownerId: 'owner', pnr: 'J4R8GZ', status: 'CONFIRMED', holdId: randomUUID(), paymentReference: 'pay_secret_1', idempotencyKey: randomUUID(), passengers: [passenger], itineraries: [itinerary], grandTotal: { currency: 'USD', total: '210.00' }, changes: [{ changedAt: '2026-11-14T10:00:00.000Z', description: 'CREATED' }], attempts: 0, ...overrides });
const ancillaries = { getAssignments: async () => [{ passengerId: 'pax-1', segmentId: SEGMENT, seatNumber: '12A', status: 'CONFIRMED' }], getBaggageOptions: async () => [{ passengerId: 'pax-1', itineraryId: ITINERARY, alreadyPurchased: 2 }] } as never;
const ticketing = { listTickets: async () => [{ ticketId: 't1', passengerId: 'pax-1', status: 'ISSUED', eTicketNumber: '0572000012345', segments: [{ segmentId: SEGMENT, status: 'ISSUED', couponNumber: '1' }] }] } as never;
const FORBIDDEN = ['AB1234567', 'ana@example.com', '+593990000000', '1990-01-01', 'pay_secret_1', '2030-01-01', '0572000012345'];

const seed = async (...values: StoredReservation[]) => { const store = new InMemoryReservationStore(); for (const value of values) await store.create(value); return new ReservationQueries(store, ancillaries, ticketing); };

describe('F12c-4a: AdminGetReservationByPnr', () => {
  it('RSV-ADM-01: encuentra por PNR una reserva de la web y de un socio (cualquier dueño) y marca el canal', async () => {
    const queries = await seed(stored({ ownerId: 'sub-web-1', pnr: 'AAAAA2', paymentChannel: 'WEB' }), stored({ ownerId: 'cliente-x~usuario-9', pnr: 'BBBBB3', paymentChannel: 'BOOKING' }));
    const web = await queries.adminByPnr({ pnr: 'AAAAA2' }) as Record<string, unknown>; const partner = await queries.adminByPnr({ pnr: 'BBBBB3' }) as Record<string, unknown>;
    expect(web).toMatchObject({ pnr: 'AAAAA2', channel: 'WEB', status: 'CONFIRMED' }); expect(web).not.toHaveProperty('partnerRef');
    expect(partner).toMatchObject({ pnr: 'BBBBB3', channel: 'PARTNER', partnerRef: partnerRef('cliente-x~usuario-9') });
  });
  it('RSV-ADM-02: la vista trae nombres, asientos, equipaje, boletos (últimos 4) y horas locales de cada aeropuerto', async () => {
    const queries = await seed(stored({ ownerId: 'o' }));
    const view = await queries.adminByPnr({ pnr: 'J4R8GZ' }) as { segments: Array<Record<string, string>>; passengers: Array<Record<string, unknown>>; tickets: Array<Record<string, unknown>>; grandTotal: unknown };
    expect(view.segments[0]).toMatchObject({ flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureLocal: '2026-11-15T10:00', arrivalLocal: '2026-11-15T11:00', cabinClass: 'ECONOMY' });
    expect(view.passengers[0]).toMatchObject({ firstName: 'Ana', lastName: 'Pérez', seats: [{ segmentId: SEGMENT, seatNumber: '12A', status: 'CONFIRMED' }], extraBaggage: [{ itineraryId: ITINERARY, quantity: 2 }] });
    expect(view.tickets[0]).toMatchObject({ status: 'ISSUED', eTicketLast4: '2345', segments: [{ segmentId: SEGMENT, status: 'ISSUED' }] }); expect(view.grandTotal).toEqual({ currency: 'USD', total: '210.00' });
  });
  it('RSV-ADM-03: la vista NO contiene documento, correo, teléfono, nacimiento, referencia de pago, boleto completo, dueño ni id del socio', async () => {
    const queries = await seed(stored({ ownerId: 'cliente-x~usuario-9', paymentChannel: 'BOOKING' }));
    const text = JSON.stringify(await queries.adminByPnr({ pnr: 'J4R8GZ' }));
    for (const forbidden of [...FORBIDDEN, 'cliente-x', 'usuario-9']) expect(text).not.toContain(forbidden);
    for (const key of ['documentNumber', 'contact', 'email', 'phone', 'birthDate', 'paymentReference', 'ownerId', 'eTicketNumber', 'nationality']) expect(text).not.toContain(`"${key}"`);
  });
  it('RSV-ADM-04: es una lista blanca: un campo nuevo en el origen no sale', () => {
    const view = adminBookingView({ ownerId: 'o' }, { bookingId: 'b', pnr: 'P', status: 'CONFIRMED', createdAt: 'c', grandTotal: { currency: 'USD', total: '1.00', secretoNuevo: 'x' }, secretoNuevo: 'y', passengers: [{ passengerId: 'p', firstName: 'A', lastName: 'B', passengerType: 'ADULT', secretoNuevo: 'z' }], itineraries: [], tickets: [] });
    expect(JSON.stringify(view)).not.toContain('secretoNuevo');
  });
  it('RSV-ADM-05: un PNR inexistente es NOT_FOUND', async () => {
    const queries = await seed(stored({}));
    await expect(queries.adminByPnr({ pnr: 'ZZZZZZ' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('RSV-ADM-06: una reserva sin asientos ni boletos ni equipaje devuelve listas vacías (no falla)', async () => {
    const store = new InMemoryReservationStore(); await store.create(stored({}));
    const view = await new ReservationQueries(store).adminByPnr({ pnr: 'J4R8GZ' }) as { tickets: unknown[]; passengers: Array<{ seats: unknown[]; extraBaggage: unknown[] }> };
    expect(view.tickets).toEqual([]); expect(view.passengers[0].seats).toEqual([]); expect(view.passengers[0].extraBaggage).toEqual([]);
  });
  it('RSV-ADM-07: el estado CANCEL_PENDING se muestra como CANCELLATION_PENDING, como en el resto de la API', async () => {
    const queries = await seed(stored({ status: 'CANCEL_PENDING' }));
    expect(await queries.adminByPnr({ pnr: 'J4R8GZ' })).toMatchObject({ status: 'CANCELLATION_PENDING' });
  });
});

const metadata = async (role: string | undefined, key = KEY): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', 'sub-admin'); if (role) value.set('x-role', role);
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};
describe('F12c-4a: el controlador de AdminGetReservationByPnr', () => {
  const controller = () => { const calls: unknown[] = []; return { calls, controller: new ReservationController({ adminGetReservationByPnr: async (input: unknown) => { calls.push(input); return { pnr: 'J4R8GZ' }; } }) }; };
  it.each([['customer'], ['partner'], ['system'], [undefined]])('RSV-ADM-08: el rol %s no puede buscar por PNR (PERMISSION_DENIED) y no llega al caso de uso', async (role) => {
    const { calls, controller: instance } = controller();
    expect(() => instance.adminGetReservationByPnr({ pnr: 'J4R8GZ' }, undefined as never)).toThrow();
    expect(() => instance.adminGetReservationByPnr({ pnr: 'J4R8GZ' }, new Metadata())).toThrow();
    await expect(Promise.resolve().then(async () => instance.adminGetReservationByPnr({ pnr: 'J4R8GZ' }, await metadata(role)))).rejects.toMatchObject({ error: { code: 7 } });
    expect(calls).toHaveLength(0);
  });
  it('RSV-ADM-09: el rol admin sí; el esquema estricto no admite dueño ni campos extra, ni un PNR con caracteres fuera del alfabeto', async () => {
    const { calls, controller: instance } = controller(); const admin = await metadata('admin');
    await expect(instance.adminGetReservationByPnr({ pnr: 'J4R8GZ' }, admin)).resolves.toEqual({ pnr: 'J4R8GZ' });
    for (const bad of [{ pnr: 'J4R8GZ', ownerId: 'otro' }, { pnr: 'J4R8GZ', owner: 'x' }, { pnr: 'j4r8gz' }, { pnr: 'J4R8G0' }, { pnr: 'J4R8GI' }, { pnr: 'J4R8G' }, {}]) expect(() => instance.adminGetReservationByPnr(bad, admin)).toThrow();
    expect(calls).toEqual([{ pnr: 'J4R8GZ' }]);
  });
});
