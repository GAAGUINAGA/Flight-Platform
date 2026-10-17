import { expect, it } from '@jest/globals';
import { DomainError } from '@flight-platform/shared';
import { Baggage, BaggageAllowanceItem, BaggageItem, BaggageStore } from '../src/application/baggage';
import { BookingOwnershipStore, ownershipNotFound } from '../src/application/booking-ownership';

const ids = { bookingId: '00000000-0000-4000-8000-000000000001', passengerId: '00000000-0000-4000-8000-000000000002', itineraryId: '00000000-0000-4000-8000-000000000003' };
class MemoryBaggage implements BaggageStore {
  values: BaggageItem[] = [];
  allowances: BaggageAllowanceItem[] = [];
  async registerAllowances(input: BaggageAllowanceItem[]) { this.allowances.push(...input); }
  async listAllowances(bookingId: string, ownerId: string) { return this.allowances.filter((item) => item.bookingId === bookingId && item.ownerId === ownerId); }
  async reserve(input: BaggageItem[]) { this.values.push(...input); }
  async purchase(input: BaggageItem, max: number) { const total = this.values.filter((item) => item.bookingId === input.bookingId && item.ownerId === input.ownerId && item.passengerId === input.passengerId && item.itineraryId === input.itineraryId && item.status !== 'RELEASED').reduce((sum, item) => sum + item.quantity, 0) + input.quantity; if (total > max) throw new DomainError('BAGGAGE_LIMIT_EXCEEDED'); this.values.push(input); return total; }
  async list(bookingId: string, ownerId: string) { return this.values.filter((item) => item.bookingId === bookingId && item.ownerId === ownerId); }
  async release(bookingId: string, ownerId: string) { this.values.filter((item) => item.bookingId === bookingId && item.ownerId === ownerId).forEach((item) => { item.status = 'RELEASED'; }); }
}

it('ANC-08 / U: exceder el máximo de equipaje devuelve BAGGAGE_LIMIT_EXCEEDED', async () => {
  const owners = new Map<string, string>();
  const ownership: BookingOwnershipStore = { claimOrAssertOwner: async (bookingId, ownerId) => { const saved = owners.get(bookingId); if (saved && saved !== ownerId) ownershipNotFound(); owners.set(bookingId, ownerId); }, assertOwner: async (bookingId, ownerId) => { if (owners.get(bookingId) !== ownerId) ownershipNotFound(); } };
  const service = new Baggage(new MemoryBaggage(), 3, ownership);
  await ownership.claimOrAssertOwner(ids.bookingId, 'owner');
  await expect(service.purchase({ ...ids, ownerId: 'owner', quantity: 3 })).resolves.toMatchObject({ totalBaggage: 3 });
  await expect(service.purchase({ ...ids, ownerId: 'owner', quantity: 1 })).rejects.toThrow(expect.objectContaining({ code: 'BAGGAGE_LIMIT_EXCEEDED' }));
});
