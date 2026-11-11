import { expect, it } from '@jest/globals';
import { DomainError } from '@flight-platform/shared';
import { Assignment, AssignmentStore, HeldSeatRow, HeldSeatStore, heldPassengerId, SeatAssignments } from '../src/application/seat-assignments';
import { BookingOwnershipStore, ownershipNotFound } from '../src/application/booking-ownership';
import { GetSeatMapForOffer } from '../src/application/seat-map';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOLD = id(100); const SEGMENT = id(4); const FLIGHT = id(5);
const layout = ['1A', '1B', '1C'].map((seatNumber) => ({ cabinClass: 'ECONOMY', seatNumber, rowNumber: 1, characteristics: [] as string[] }));
const pricing = { resolveSegment: async () => ({ segmentId: SEGMENT, flightInstanceId: FLIGHT, aircraft: 'E190' }), getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) };

/** Réplica en memoria de las reglas del almacén real (vencidas = libres, una vigente por asiento). */
class Memory implements AssignmentStore, HeldSeatStore {
  rows: Array<Assignment & { holdId?: string; expiresAt?: Date; convertedTo?: string }> = [];
  private live(row: Memory['rows'][number], now: Date) { return row.status !== 'RELEASED' && !(row.status === 'HELD' && row.expiresAt! <= now); }
  private taken(flight: string, seat: string, now: Date) { return this.rows.some((row) => row.flightInstanceId === flight && row.seatNumber === seat && this.live(row, now)); }
  clock = new Date('2026-11-09T10:00:00Z');
  async holdMany(input: { holdId: string; ownerId: string; expiresAt: Date; seats: HeldSeatRow[] }) {
    if (input.seats.some((seat) => this.taken(seat.flightInstanceId, seat.seatNumber, this.clock))) throw new DomainError('SEAT_TAKEN');
    input.seats.forEach((seat, index) => this.rows.push({ bookingId: input.holdId, ownerId: input.ownerId, passengerId: heldPassengerId(input.holdId, index), segmentId: seat.segmentId, flightInstanceId: seat.flightInstanceId, seatNumber: seat.seatNumber, passengerType: 'ADULT', cabinClass: seat.cabinClass, status: 'HELD', holdId: input.holdId, expiresAt: input.expiresAt }));
  }
  async releaseHold(holdId: string, ownerId: string) { for (const row of this.rows) if (row.holdId === holdId && row.ownerId === ownerId && row.status === 'HELD') row.status = 'RELEASED'; }
  async listHeld(holdId: string, ownerId: string, now: Date) { return this.rows.filter((row) => row.holdId === holdId && row.ownerId === ownerId && row.status === 'HELD' && row.expiresAt! > now).map((row) => ({ segmentId: row.segmentId, seatNumber: row.seatNumber })); }
  async reserveFromHold(input: { holdId: string; bookingId: string; ownerId: string; assignments: Assignment[] }) {
    const snapshot = this.rows.map((row) => ({ ...row }));
    for (const row of this.rows) if (row.holdId === input.holdId && row.ownerId === input.ownerId && row.status === 'HELD') { row.status = 'RELEASED'; row.convertedTo = input.bookingId; }
    try { for (const item of input.assignments) { if (this.taken(item.flightInstanceId, item.seatNumber, this.clock)) throw new DomainError('SEAT_TAKEN'); this.rows.push({ ...item }); } return input.assignments; }
    catch (error) { this.rows = snapshot; throw error; }
  }
  async restoreHeld(bookingId: string, ownerId: string, now: Date) { for (const row of this.rows) if (row.convertedTo === bookingId && row.ownerId === ownerId && row.expiresAt! > now && !this.taken(row.flightInstanceId, row.seatNumber, now)) { row.status = 'HELD'; row.convertedTo = undefined; } }
  async create(value: Assignment) { if (this.taken(value.flightInstanceId, value.seatNumber, this.clock)) throw new DomainError('SEAT_TAKEN'); this.rows.push(value); return value; }
  async find(bookingId: string, ownerId: string, passengerId: string, segmentId: string) { return this.rows.find((row) => row.bookingId === bookingId && row.ownerId === ownerId && row.passengerId === passengerId && row.segmentId === segmentId) ?? null; }
  async list(bookingId: string, ownerId: string) { return this.rows.filter((row) => row.bookingId === bookingId && row.ownerId === ownerId); }
  async updateStatus(bookingId: string, ownerId: string, status: 'CONFIRMED' | 'RELEASED') { return this.rows.filter((row) => row.bookingId === bookingId && row.ownerId === ownerId).map((row) => { row.status = status; return row; }); }
  async markCheckedIn(): Promise<Assignment> { throw new DomainError('NOT_FOUND'); }
  async activeSeatNumbers(flight: string) { return this.rows.filter((row) => row.flightInstanceId === flight && this.live(row, this.clock)).map((row) => row.seatNumber); }
  async seatStatuses(flight: string, now: Date) { return new Map(this.rows.filter((row) => row.flightInstanceId === flight && this.live(row, now)).map((row) => [row.seatNumber, row.status])); }
}
const owners = (...booked: string[]): BookingOwnershipStore => { const map = new Map(booked.map((bookingId) => [bookingId, 'owner'])); return { claimOrAssertOwner: async (bookingId, ownerId) => { map.set(bookingId, map.get(bookingId) ?? ownerId); if (map.get(bookingId) !== ownerId) ownershipNotFound(); }, assertOwner: async (bookingId, ownerId) => { if (map.get(bookingId) !== ownerId) ownershipNotFound(); } }; };
const make = () => { const store = new Memory(); const service = new SeatAssignments(pricing, { listByAircraft: async () => layout }, store, owners(), undefined, store, () => store.clock); return { store, service }; };
const hold = (service: SeatAssignments, seats: string[], holdId = HOLD, ownerId = 'owner', expiresAt = '2026-11-09T10:15:00Z') => service.holdSeats({ holdId, ownerId, expiresAt, seats: seats.map((seatNumber) => ({ segmentId: SEGMENT, seatNumber })) });
const passenger = (n: number, seatNumber: string) => ({ passengerId: id(n), segmentId: SEGMENT, seatNumber, passengerType: 'ADULT' as const, cabinClass: 'ECONOMY' as const });

it('HELD-01: apartar un asiento y apartarlo desde otro hold da SEAT_TAKEN sin dejar filas del segundo hold', async () => {
  const { store, service } = make();
  await hold(service, ['1A']);
  await expect(hold(service, ['1B', '1A'], id(101))).rejects.toThrow(expect.objectContaining({ code: 'SEAT_TAKEN' }));
  expect(store.rows.filter((row) => row.holdId === id(101))).toHaveLength(0);
});

it('HELD-02: un asiento de una reserva real también cuenta como ocupado al apartar', async () => {
  const { service } = make();
  await service.reserve({ bookingId: id(1), ownerId: 'owner', assignments: [passenger(2, '1A')] });
  await expect(hold(service, ['1A'])).rejects.toThrow(expect.objectContaining({ code: 'SEAT_TAKEN' }));
});

it('HELD-03: el vencimiento libera sin scheduler: un hold vencido no estorba ni aparece en el mapa', async () => {
  const { store, service } = make();
  await hold(service, ['1A']);
  const map = new GetSeatMapForOffer(pricing, { listByAircraft: async () => layout }, store, () => store.clock);
  const seat = async () => (await map.execute({ offerId: id(9), segmentId: SEGMENT })).cabins[0].rows[0].seats[0];
  expect(await seat()).toMatchObject({ seatNumber: '1A', isAvailable: false, status: 'HELD' });
  store.clock = new Date('2026-11-09T10:15:01Z');
  expect(await seat()).toMatchObject({ seatNumber: '1A', isAvailable: true });
  expect((await seat()).status).toBeUndefined();
  await expect(hold(service, ['1A'], id(101), 'otro', '2026-11-09T10:30:00Z')).resolves.toBeDefined();
});

it('HELD-04: liberar el hold devuelve el asiento; un hold ajeno no se libera', async () => {
  const { store, service } = make();
  await hold(service, ['1A']);
  await service.releaseHeld({ holdId: HOLD, ownerId: 'intruso' });
  expect(await store.activeSeatNumbers(FLIGHT)).toEqual(['1A']);
  await service.releaseHeld({ holdId: HOLD, ownerId: 'owner' }); await service.releaseHeld({ holdId: HOLD, ownerId: 'owner' });
  expect(await store.activeSeatNumbers(FLIGHT)).toEqual([]);
});

it('HELD-05: transición a reserva con los mismos asientos: pasan a PROVISIONAL sin SEAT_TAKEN contra su propio hold', async () => {
  const { store, service } = make();
  await hold(service, ['1A', '1B']);
  const saved = await service.reserve({ bookingId: id(1), ownerId: 'owner', holdId: HOLD, assignments: [passenger(2, '1A'), passenger(3, '1B')] });
  expect(saved.map((item) => item.status)).toEqual(['PROVISIONAL', 'PROVISIONAL']);
  expect(await store.seatStatuses(FLIGHT, store.clock)).toEqual(new Map([['1A', 'PROVISIONAL'], ['1B', 'PROVISIONAL']]));
});

it('HELD-06: con otros asientos se liberan los del hold; si alguno nuevo está ocupado hay SEAT_TAKEN y el hold queda como estaba', async () => {
  const { store, service } = make();
  await hold(service, ['1A']);
  await service.reserve({ bookingId: id(7), ownerId: 'otro', assignments: [passenger(8, '1C')] });
  await expect(service.reserve({ bookingId: id(1), ownerId: 'owner', holdId: HOLD, assignments: [passenger(2, '1C')] })).rejects.toThrow(expect.objectContaining({ code: 'SEAT_TAKEN' }));
  expect(await store.listHeld(HOLD, 'owner', store.clock)).toEqual([{ segmentId: SEGMENT, seatNumber: '1A' }]);
  await service.reserve({ bookingId: id(1), ownerId: 'owner', holdId: HOLD, assignments: [passenger(2, '1B')] });
  expect(await store.seatStatuses(FLIGHT, store.clock)).toEqual(new Map([['1B', 'PROVISIONAL'], ['1C', 'PROVISIONAL']]));
});

it('HELD-07: compensación: releaseAll con restoreHold devuelve los asientos al hold vigente', async () => {
  const { store, service } = make();
  await hold(service, ['1A']);
  await service.reserve({ bookingId: id(1), ownerId: 'owner', holdId: HOLD, assignments: [passenger(2, '1B')] });
  await service.release({ bookingId: id(1), ownerId: 'owner', restoreHold: true });
  expect(await store.seatStatuses(FLIGHT, store.clock)).toEqual(new Map([['1A', 'HELD']]));
});

it('HELD-08: la reserva con solo holdId (sin asientos) libera los del hold; una reserva vacía sin holdId sigue siendo inválida', async () => {
  const { store, service } = make();
  await hold(service, ['1A']);
  await service.reserve({ bookingId: id(1), ownerId: 'owner', holdId: HOLD, assignments: [] });
  expect(await store.activeSeatNumbers(FLIGHT)).toEqual([]);
  await expect(service.reserve({ bookingId: id(2), ownerId: 'owner', assignments: [] })).rejects.toThrow('Rpc Exception');
});

it('HELD-09: entradas inválidas: duplicado, formato, vencimiento pasado y campos extra', async () => {
  const { service } = make();
  await expect(hold(service, ['1A', '1A'])).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  await expect(hold(service, ['ZZ'])).rejects.toThrow('Rpc Exception');
  await expect(hold(service, ['1A'], HOLD, 'owner', '2026-11-09T09:00:00Z')).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    await expect(service.holdSeats({ holdId: HOLD, ownerId: 'owner', expiresAt: '2026-11-09T10:15:00Z', seats: [{ segmentId: SEGMENT, seatNumber: '1A', extra: 1 }] })).rejects.toThrow('Rpc Exception');
});

it('HELD-10: un asiento que no existe en el avión se rechaza y el passengerId sintético no choca con pasajeros reales', async () => {
  const { service } = make();
  await expect(hold(service, ['2A'])).rejects.toThrow(expect.objectContaining({ code: 'SEAT_CABIN_MISMATCH' }));
  expect(heldPassengerId(HOLD, 0)).not.toBe(heldPassengerId(HOLD, 1));
  expect(heldPassengerId(HOLD, 1)).toMatch(/^[0-9a-f-]{36}$/);
  await expect(service.assignments({ bookingId: HOLD, ownerId: 'owner' })).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
});
