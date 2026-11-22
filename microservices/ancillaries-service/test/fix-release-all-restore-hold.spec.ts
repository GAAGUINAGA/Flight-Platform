import { of } from 'rxjs';
import { Metadata } from '@grpc/grpc-js';
import { InternalKeyInterceptor } from '@flight-platform/shared';
import { Baggage, BaggageItem, BaggageStore } from '../src/application/baggage';
import { BookingOwnershipStore } from '../src/application/booking-ownership';
import { SeatAssignments } from '../src/application/seat-assignments';
import { AncillariesController } from '../src/infrastructure/grpc/ancillaries.controller';

const KEY = 'k'.repeat(32);
const bookingId = '00000000-0000-4000-8000-000000000001';
const metadata = async (): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', KEY); value.set('x-owner-id', 'owner'); value.set('x-role', 'system');
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};

describe('fix-compra-ejecutiva · ReleaseAll con restoreHold (compensación de CreateReservation)', () => {
  it('ANC-REL-01: con restoreHold libera asientos Y equipaje; el rechazo del esquema estricto de equipaje ocultaba la compensación', async () => {
    const calls: string[] = []; const items: BaggageItem[] = [{ bookingId, ownerId: 'owner', passengerId: null, itineraryId: bookingId, quantity: 1, status: 'PROVISIONAL' }];
    const seats = { assertOwnership: async () => { calls.push('seats.assertOwnership'); }, release: async (input: { restoreHold?: boolean }) => { calls.push(`seats.release restoreHold=${String(input.restoreHold)}`); } } as unknown as SeatAssignments;
    const store = { release: async () => { calls.push('baggage.release'); items.forEach((item) => { item.status = 'RELEASED'; }); } } as unknown as BaggageStore;
    const ownership: BookingOwnershipStore = { claimOrAssertOwner: async () => undefined, assertOwner: async () => undefined };
    const controller = new AncillariesController({ seats, baggage: new Baggage(store, 3, ownership) });
    for (const restoreHold of [true, false]) {
      calls.length = 0; items[0].status = 'PROVISIONAL';
      await expect(controller.releaseAll({ bookingId, restoreHold }, await metadata())).resolves.toEqual({});
      expect(calls).toEqual(['seats.assertOwnership', `seats.release restoreHold=${String(restoreHold)}`, 'baggage.release']);
      expect(items[0].status).toBe('RELEASED');
    }
  });
});
