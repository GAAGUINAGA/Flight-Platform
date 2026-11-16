import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { InternalKeyInterceptor } from '@flight-platform/shared';
import { of } from 'rxjs';
import { Metadata } from '@grpc/grpc-js';
import { ReservationQueries } from '../src/application/queries';
import { InMemoryReservationStore, StoredReservation } from '../src/application/reservation-store';
import { ReservationController } from '../src/infrastructure/grpc/reservation.controller';

/** F12c-4b (ADR-F12c4-01): AdminResolveBookingOwner — solo para Operations (rol admin); el dueño es la respuesta, nunca la entrada. */
const KEY = 'k'.repeat(32);
const stored = (overrides: Partial<StoredReservation>): StoredReservation => ({ id: randomUUID(), ownerId: 'owner', pnr: 'J4R8GZ', status: 'CONFIRMED', holdId: randomUUID(), paymentReference: 'pay_1', idempotencyKey: randomUUID(), passengers: [], itineraries: [], grandTotal: { currency: 'USD', total: '1.00' }, changes: [], attempts: 0, ...overrides });
const metadata = async (role?: string): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', KEY); value.set('x-owner-id', 'sub-1'); if (role) value.set('x-role', role);
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};

describe('F12c-4b: AdminResolveBookingOwner (RSV-OWN)', () => {
  const setup = async () => { const store = new InMemoryReservationStore(); const row = stored({ ownerId: 'cliente-x~usuario-9', pnr: 'BBBBB3' }); await store.create(row); const queries = new ReservationQueries(store); return { row, controller: new ReservationController({ adminResolveBookingOwner: (value) => queries.adminResolveOwner(value as never) }) }; };
  it('RSV-OWN-01: resuelve bookingId y dueño de un PNR de cualquier canal', async () => {
    const { row, controller } = await setup();
    await expect(controller.adminResolveBookingOwner({ pnr: 'BBBBB3' }, await metadata('admin'))).resolves.toEqual({ bookingId: row.id, ownerId: 'cliente-x~usuario-9' });
  });
  it('RSV-OWN-02: PNR inexistente ⇒ NOT_FOUND; esquema estricto: sin dueño, sin campos extra, PNR con el alfabeto real', async () => {
    const { controller } = await setup();
    await expect(controller.adminResolveBookingOwner({ pnr: 'ZZZZZZ' }, await metadata('admin'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const bad of [{ pnr: 'BBBBB3', ownerId: 'x' }, { pnr: 'bbbbb3' }, { pnr: 'BBBBB' }, { pnr: 'BBBBBO' }, {}]) { const meta = await metadata('admin'); await expect(Promise.resolve().then(() => controller.adminResolveBookingOwner(bad, meta))).rejects.toMatchObject({ error: { code: 3 } }); }
  });
  it.each([['customer'], ['partner'], ['system'], [undefined]])('RSV-OWN-03: el rol %s ⇒ PERMISSION_DENIED (el dueño de una reserva no sale a nadie más)', async (role) => {
    const { controller } = await setup();
    await expect(Promise.resolve().then(async () => controller.adminResolveBookingOwner({ pnr: 'BBBBB3' }, await metadata(role)))).rejects.toMatchObject({ error: { code: 7 } });
  });
});
