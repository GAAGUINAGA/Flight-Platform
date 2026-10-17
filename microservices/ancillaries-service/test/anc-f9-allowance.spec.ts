import { expect, it } from '@jest/globals';
import { Baggage, BaggageAllowanceItem, BaggageStore } from '../src/application/baggage';
import { BookingOwnershipStore, ownershipNotFound } from '../src/application/booking-ownership';

const bookingId = '00000000-0000-4000-8000-000000000001';
const passengerId = '00000000-0000-4000-8000-000000000002';
const first = '00000000-0000-4000-8000-000000000003';
const second = '00000000-0000-4000-8000-000000000004';
class Store implements BaggageStore {
  allowances: BaggageAllowanceItem[] = [];
  async registerAllowances(input: BaggageAllowanceItem[]) { this.allowances = input; }
  async listAllowances(booking: string, owner: string) { return this.allowances.filter((item) => item.bookingId === booking && item.ownerId === owner); }
  async reserve() {}
  async purchase() { return 1; }
  async list() { return []; }
  async release() {}
}
const setup = () => {
  const owners = new Map<string, string>();
  const ownership: BookingOwnershipStore = { claimOrAssertOwner: async (id, owner) => { const saved = owners.get(id); if (saved && saved !== owner) ownershipNotFound(); owners.set(id, owner); }, assertOwner: async (id, owner) => { if (owners.get(id) !== owner) ownershipNotFound(); } };
  return new Baggage(new Store(), 3, ownership);
};
it('F9-0 / U: registra y devuelve franquicias cero y N por itinerario', async () => {
  const service = setup();
  await service.registerAllowances({ bookingId, ownerId: 'owner', allowances: [{ passengerId, itineraryId: first, checkedBaggageIncluded: 0 }, { passengerId, itineraryId: second, checkedBaggageIncluded: 2 }] });
  expect(await service.options({ bookingId, ownerId: 'owner' })).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId, itineraryId: first, checkedBaggageIncluded: 0, alreadyPurchased: 0 }), expect.objectContaining({ passengerId, itineraryId: second, checkedBaggageIncluded: 2, alreadyPurchased: 0 })]));
});
it('F9-0 / U: la franquicia fija el owner antes de cualquier asiento o equipaje extra', async () => {
  const service = setup();
  await service.registerAllowances({ bookingId, ownerId: 'owner', allowances: [{ passengerId, itineraryId: first, checkedBaggageIncluded: 0 }] });
  await expect(service.options({ bookingId, ownerId: 'other' })).rejects.toThrow('NOT_FOUND');
});
