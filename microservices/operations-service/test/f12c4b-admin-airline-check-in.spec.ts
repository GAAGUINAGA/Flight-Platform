import { describe, expect, it, jest } from '@jest/globals';
import { of } from 'rxjs';
import { Metadata } from '@grpc/grpc-js';
import { DomainError, InternalKeyInterceptor } from '@flight-platform/shared';
import { AdminCheckIn, AdminListBoardingPasses, BookingOwnerResolver } from '../src/application/admin-airline-check-in';
import { ListBoardingPasses } from '../src/application/boarding-passes';
import { CheckInUseCase } from '../src/application/check-in';
import { CheckInPass, CheckInResult, CheckInStore } from '../src/application/check-in-ports';
import { FlightStore } from '../src/application/ports';
import { OperationsController } from '../src/infrastructure/grpc/operations.controller';

/** F12c-4b (ADR-F12c4-01): el check-in de la aerolínea usa el MISMO caso de uso que el cliente, con el dueño resuelto en el servidor. */
const bookingId = '00000000-0000-4000-8000-000000000001'; const segmentId = '00000000-0000-4000-8000-000000000002'; const flightId = '00000000-0000-4000-8000-000000000003'; const passengerId = '00000000-0000-4000-8000-000000000004';
const PNR = 'J4R8GZ'; const REAL_OWNER = 'partner-owner-777'; const KEY = 'k'.repeat(32);
const DEPARTURE = '2026-10-20T12:00:00.000Z';

class MemoryStore implements CheckInStore {
  result: CheckInResult | null = null; begun = false; eventPublished = false; passes: CheckInPass[] = []; owners = new Set<string>();
  async find(owner: string, booking: string) { this.owners.add(owner); return this.begun && booking === bookingId ? { status: this.result?.status ?? 'IN_PROGRESS', result: this.result, eventPublished: this.eventPublished } : null; }
  async begin(owner: string) { this.owners.add(owner); if (this.begun) return false; this.begun = true; return true; }
  async resume() { return this.begun; }
  async savePass(owner: string, booking: string, pass: CheckInPass) { void booking; this.owners.add(owner); this.passes.push(pass); }
  async complete(owner: string, result: CheckInResult) { this.owners.add(owner); this.result = result; }
  async abort() { this.begun = false; this.result = null; this.passes = []; }
  async restore(owner: string, result: CheckInResult) { void owner; this.result = result; }
  async listPasses(owner: string, booking: string) { this.owners.add(owner); return booking === bookingId ? this.passes : []; }
  async claimStale() { return []; } async releaseRecoveryClaim() { return undefined; } async markBlocked() { return undefined; } async listUnpublished() { return []; }
  async markEventPublished() { this.eventPublished = true; }
}
const noFlights: FlightStore = { find: async () => null, findByInstance: async () => null, save: async () => undefined, update: async () => undefined };
const snapshot = (status = 'CONFIRMED') => ({ bookingId, pnr: PNR, status, passengers: [{ passengerId, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP210', departure: { at: DEPARTURE } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] });

function build(now: string, status = 'CONFIRMED') {
  const store = new MemoryStore(); const publish = jest.fn(async (event: unknown) => { void event; }); const seenOwners: string[] = [];
  const resolve = jest.fn(async (pnr: string) => { if (pnr !== PNR) throw new DomainError('NOT_FOUND'); return { bookingId, ownerId: REAL_OWNER }; });
  const owners: BookingOwnerResolver = { resolve };
  const checkIn = new CheckInUseCase({ getSnapshot: async (owner: string) => { seenOwners.push(owner); if (owner !== REAL_OWNER) throw new DomainError('NOT_FOUND'); return snapshot(status); } }, { getCoupons: async () => [{ passengerId, segmentId, status: 'ISSUED' }] }, { assign: async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }) }, noFlights, store, { publish }, () => new Date(now), 48, 60);
  const passes = new ListBoardingPasses({ getSnapshot: async (owner: string) => { if (owner !== REAL_OWNER) throw new DomainError('NOT_FOUND'); return snapshot(status); } }, noFlights, store);
  return { store, publish, resolve, seenOwners, admin: new AdminCheckIn(owners, checkIn), adminPasses: new AdminListBoardingPasses(owners, passes) };
}

describe('F12c-4b: AdminCheckIn (OPS-AC)', () => {
  it('OPS-AC-01: resuelve el DUEÑO REAL en el servidor y publica booking.checked_in con ese dueño (llega al socio); el evento no lleva al administrador', async () => {
    const { admin, store, publish, seenOwners } = build('2026-10-19T12:00:00.000Z');
    const result = await admin.execute({ pnr: PNR });
    expect(result).toMatchObject({ bookingId, status: 'COMPLETED', checkedInPassengers: [{ passengerId, status: 'CHECKED_IN', segments: [{ segmentId, seat: '12A', status: 'CHECKED_IN' }] }] });
    expect([...new Set(seenOwners)]).toEqual([REAL_OWNER]); expect([...store.owners]).toEqual([REAL_OWNER]);
    expect(publish).toHaveBeenCalledTimes(1);
    const event = publish.mock.calls[0][0] as Record<string, unknown>;
    expect(event).toMatchObject({ ownerId: REAL_OWNER, bookingId, pnr: PNR, eventType: 'booking.checked_in' });
    expect(Object.keys(event).sort()).toEqual(['bookingId', 'eventType', 'occurredAt', 'ownerId', 'pnr']);
  });
  it('OPS-AC-02: las mismas reglas que el cliente — fuera de la ventana NO se fuerza (P5): antes de las 48 h y después del cierre', async () => {
    for (const now of ['2026-10-17T11:59:00.000Z', '2026-10-20T11:30:00.000Z']) {
      const { admin, store, publish } = build(now);
      await expect(admin.execute({ pnr: PNR })).rejects.toBeInstanceOf(DomainError);
      expect(store.passes).toEqual([]); expect(publish).not.toHaveBeenCalled();
    }
  });
  it('OPS-AC-03: una reserva que no está CONFIRMED no admite check-in', async () => {
    for (const status of ['CANCELLED', 'PENDING_PAYMENT', 'FAILED']) await expect(build('2026-10-19T12:00:00.000Z', status).admin.execute({ pnr: PNR })).rejects.toMatchObject({ code: 'BOOKING_NOT_CONFIRMED' });
  });
  it('OPS-AC-04: sin boleto emitido no hay pase (FAILED) y no se publica el evento', async () => {
    const { store, publish } = build('2026-10-19T12:00:00.000Z');
    const useCase = new CheckInUseCase({ getSnapshot: async () => snapshot() }, { getCoupons: async () => [] }, { assign: async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }) }, noFlights, store, { publish }, () => new Date('2026-10-19T12:00:00.000Z'), 48, 60);
    const result = await new AdminCheckIn({ resolve: async () => ({ bookingId, ownerId: REAL_OWNER }) }, useCase).execute({ pnr: PNR });
    expect(result.checkedInPassengers[0].status).toBe('FAILED'); expect(store.passes).toEqual([]); expect(publish).not.toHaveBeenCalled();
  });
  it('OPS-AC-05: idempotente — repetir no duplica pases ni eventos', async () => {
    const { admin, store, publish } = build('2026-10-19T12:00:00.000Z');
    const first = await admin.execute({ pnr: PNR }); const second = await admin.execute({ pnr: PNR });
    expect(second).toEqual(first); expect(store.passes).toHaveLength(1); expect(publish).toHaveBeenCalledTimes(1);
  });
  it('OPS-AC-06: el esquema es estricto: sin dueño, sin bookingId, sin campos extra, PNR con el alfabeto real; un PNR inexistente es NOT_FOUND', async () => {
    const { admin, resolve } = build('2026-10-19T12:00:00.000Z');
    for (const bad of [{ pnr: PNR, ownerId: 'otro' }, { pnr: PNR, bookingId }, { bookingId }, {}, { pnr: 'j4r8gz' }, { pnr: 'J4R8G' }, { pnr: 'J4R8GO' }, { pnr: 'J4R8G1' }, { pnr: 5 }, null]) await expect(admin.execute(bad)).rejects.toThrow('Rpc Exception');
    expect(resolve).not.toHaveBeenCalled();
    await expect(admin.execute({ pnr: 'ZZZZZZ' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('OPS-AC-07: los pases salen con el dueño real tras el check-in y no antes', async () => {
    const { admin, adminPasses } = build('2026-10-19T12:00:00.000Z');
    await expect(adminPasses.execute({ pnr: PNR })).rejects.toMatchObject({ code: 'BOARDING_PASS_NOT_AVAILABLE' });
    await admin.execute({ pnr: PNR });
    const list = await adminPasses.execute({ pnr: PNR });
    expect(list.bookingId).toBe(bookingId); expect(list.boardingPasses).toEqual([expect.objectContaining({ passengerId, segmentId, seat: '12A', barcodeType: 'QR' })]);
    await expect(adminPasses.execute({ pnr: PNR, ownerId: 'x' })).rejects.toThrow('Rpc Exception');
  });
});

const metadata = async (role?: string): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', KEY); value.set('x-owner-id', 'sub-1'); if (role) value.set('x-role', role);
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};
describe('F12c-4b: los controladores admin exigen rol admin (OPS-AC-08)', () => {
  const make = () => { const built = build('2026-10-19T12:00:00.000Z'); return { built, controller: new OperationsController({ adminCheckIn: built.admin, adminListBoardingPasses: built.adminPasses, validateResponse: () => undefined } as never) }; };
  it.each([['customer'], ['partner'], ['system'], [undefined]])('el rol %s ⇒ PERMISSION_DENIED y no se resuelve ni se hace nada', async (role) => {
    const { built, controller } = make();
    await expect(Promise.resolve().then(async () => controller.adminCheckIn({ pnr: PNR }, await metadata(role)))).rejects.toMatchObject({ error: { code: 7 } });
    await expect(Promise.resolve().then(async () => controller.adminListBoardingPasses({ pnr: PNR }, await metadata(role)))).rejects.toMatchObject({ error: { code: 7 } });
    expect(built.resolve).not.toHaveBeenCalled(); expect(built.store.passes).toEqual([]);
  });
  it('el rol admin hace el check-in; el cliente (no admin) con el dueño de la reserva TAMPOCO puede usar la ruta de administrador', async () => {
    const { controller, built } = make();
    await expect(controller.adminCheckIn({ pnr: PNR }, await metadata('admin'))).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(built.publish).toHaveBeenCalledTimes(1);
  });
});
