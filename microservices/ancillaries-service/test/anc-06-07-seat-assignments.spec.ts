import { expect, it } from '@jest/globals';
import { DomainError } from '@flight-platform/shared';
import { Assignment, AssignmentStore, SeatAssignments } from '../src/application/seat-assignments';
import { BookingOwnershipStore, ownershipNotFound } from '../src/application/booking-ownership';

const ids = { bookingId: '00000000-0000-4000-8000-000000000001', passengerId: '00000000-0000-4000-8000-000000000002', otherPassengerId: '00000000-0000-4000-8000-000000000003', segmentId: '00000000-0000-4000-8000-000000000004' };
class MemoryAssignments implements AssignmentStore {
  values: Assignment[] = [];
  async create(value: Assignment) { if (this.values.some((item) => item.flightInstanceId === value.flightInstanceId && item.seatNumber === value.seatNumber && item.status !== 'RELEASED')) throw new DomainError('SEAT_TAKEN'); this.values.push(value); return value; }
  async find(bookingId: string, ownerId: string, passengerId: string, segmentId: string) { return this.values.find((item) => item.bookingId === bookingId && item.ownerId === ownerId && item.passengerId === passengerId && item.segmentId === segmentId) ?? null; }
  async list(bookingId: string, ownerId: string) { return this.values.filter((item) => item.bookingId === bookingId && item.ownerId === ownerId); }
  async updateStatus(bookingId: string, ownerId: string, status: 'CONFIRMED' | 'RELEASED') { return this.values.filter((item) => item.bookingId === bookingId && item.ownerId === ownerId).map((item) => { item.status = status; return item; }); }
  async markCheckedIn(bookingId: string, ownerId: string, passengerId: string, segmentId: string) { const item = await this.find(bookingId, ownerId, passengerId, segmentId); if (!item || item.status === 'RELEASED') throw new DomainError('NOT_FOUND'); item.status = 'CHECKED_IN'; return item; }
  async activeSeatNumbers(flightInstanceId: string) { return this.values.filter((item) => item.flightInstanceId === flightInstanceId && item.status !== 'RELEASED').map((item) => item.seatNumber); }
}
const ownership = (): BookingOwnershipStore => {
  const owners = new Map<string, string>();
  owners.set(ids.bookingId, 'owner');
  return { claimOrAssertOwner: async (bookingId, ownerId) => { const saved = owners.get(bookingId); if (saved && saved !== ownerId) ownershipNotFound(); owners.set(bookingId, ownerId); }, assertOwner: async (bookingId, ownerId) => { if (owners.get(bookingId) !== ownerId) ownershipNotFound(); } };
};
const makeService = () => new SeatAssignments({ resolveSegment: async () => ({ segmentId: ids.segmentId, flightInstanceId: '00000000-0000-4000-8000-000000000005', aircraft: 'E190' }), getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) }, { listByAircraft: async () => [{ cabinClass: 'ECONOMY', seatNumber: '1A', rowNumber: 1, characteristics: [] }, { cabinClass: 'ECONOMY', seatNumber: '1B', rowNumber: 1, characteristics: [] }] }, new MemoryAssignments(), ownership());

it('ANC-06 / I: una colisión de asiento devuelve SEAT_TAKEN', async () => {
  const service = makeService();
  const first = { bookingId: ids.bookingId, ownerId: 'owner', assignments: [{ passengerId: ids.passengerId, segmentId: ids.segmentId, seatNumber: '1A', passengerType: 'ADULT' as const, cabinClass: 'ECONOMY' as const }] };
  await service.reserve(first);
  await expect(service.reserve({ ...first, assignments: [{ ...first.assignments[0], passengerId: ids.otherPassengerId }] })).rejects.toThrow(expect.objectContaining({ code: 'SEAT_TAKEN' }));
});

it('ANC-07 / I: check-in asigna el primer asiento libre de la cabina', async () => {
  const assigned = await makeService().assignAtCheckIn({ bookingId: ids.bookingId, ownerId: 'owner', passengerId: ids.passengerId, segmentId: ids.segmentId, passengerType: 'ADULT', cabinClass: 'ECONOMY' });
  expect(assigned).toMatchObject({ seatNumber: '1A', status: 'CHECKED_IN' });
});

it('ANC-07 / DCS-03: repetir check-in conserva el asiento y no altera otro pasajero', async () => {
  const service = makeService();
  const input = { bookingId: ids.bookingId, ownerId: 'owner', passengerId: ids.passengerId, segmentId: ids.segmentId, passengerType: 'ADULT' as const, cabinClass: 'ECONOMY' as const };
  await service.reserve({ bookingId: ids.bookingId, ownerId: 'owner', assignments: [{ passengerId: ids.passengerId, segmentId: ids.segmentId, seatNumber: '1A', passengerType: 'ADULT', cabinClass: 'ECONOMY' }, { passengerId: ids.otherPassengerId, segmentId: ids.segmentId, seatNumber: '1B', passengerType: 'ADULT', cabinClass: 'ECONOMY' }] });
  await expect(service.assignAtCheckIn(input)).resolves.toMatchObject({ seatNumber: '1A', status: 'CHECKED_IN' });
  await expect(service.assignAtCheckIn(input)).resolves.toMatchObject({ seatNumber: '1A', status: 'CHECKED_IN' });
  expect(await service.assignments({ bookingId: ids.bookingId, ownerId: 'owner' })).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId: ids.otherPassengerId, status: 'PROVISIONAL' })]));
});
