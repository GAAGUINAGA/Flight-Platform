import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaSeatMapStore } from '../../src/infrastructure/persistence/prisma-seat-map';
import { PrismaSeatAssignmentStore } from '../../src/infrastructure/persistence/prisma-seat-assignments';
import { PrismaBookingOwnershipStore } from '../../src/infrastructure/persistence/prisma-booking-ownership';
import { SeatAssignments } from '../../src/application/seat-assignments';

// `validate` de shared lanza una RpcException (INVALID_ARGUMENT / VALIDATION_FAILED); las reglas del dominio lanzan DomainError: ambas son VALIDATION_FAILED.
const rejectsValidation = async (promise: Promise<unknown>) => { const failure = await promise.then(() => undefined, (error: unknown) => error as { code?: string; error?: { details?: string } }); expect(failure && (failure.code === 'VALIDATION_FAILED' || failure.error?.details === 'VALIDATION_FAILED')).toBe(true); };

describe('F12a CHG: ChangeSeats atómico contra PostgreSQL', () => {
  let prisma: PrismaClient; let seats: SeatAssignments;
  const aircraft = `CHG${randomUUID().replace(/-/g, '').slice(0, 12)}`; const flightId = randomUUID(); const segmentId = randomUUID(); const owner = `chg-owner-${randomUUID().slice(0, 8)}`; const bookings: string[] = [];
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Ancillaries integration tests');
    prisma = new PrismaClient(); await prisma.$connect();
    for (const [index, [seatNumber, cabinClass]] of [['1A', 'ECONOMY'], ['1B', 'ECONOMY'], ['1C', 'ECONOMY'], ['1D', 'ECONOMY'], ['2A', 'BUSINESS']].entries()) await prisma.seatLayout.create({ data: { aircraft, cabinClass, seatNumber, rowNumber: index < 4 ? 1 : 2, characteristics: seatNumber === '1D' ? ['EMERGENCY_EXIT'] : ['WINDOW'] } });
    const store = new PrismaSeatAssignmentStore(prisma);
    seats = new SeatAssignments({ resolveSegment: async () => ({ segmentId, flightInstanceId: flightId, aircraft }), getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) }, new PrismaSeatMapStore(prisma), store, new PrismaBookingOwnershipStore(prisma), store);
  }, 60_000);
  // Cada caso parte de un vuelo sin asientos ocupados por los casos anteriores.
  beforeEach(async () => { await prisma.seatAssignment.deleteMany({ where: { flightInstanceId: flightId } }); });
  afterAll(async () => {
    try { if (prisma) { await prisma.seatAssignment.deleteMany({ where: { bookingId: { in: bookings } } }); await prisma.$executeRaw`DELETE FROM "booking_owners" WHERE "booking_id" = ANY(${bookings}::uuid[])`; await prisma.seatLayout.deleteMany({ where: { aircraft } }); } } finally { await prisma?.$disconnect(); }
  });

  const booking = async (assignments: Array<{ seat: string; type?: 'ADULT' | 'INFANT' | 'CHILD'; cabin?: string }>, ownerId = owner) => {
    const bookingId = randomUUID(); bookings.push(bookingId); const passengers = assignments.map(() => randomUUID());
    await seats.reserve({ bookingId, ownerId, assignments: assignments.filter((a) => a.type !== 'INFANT').map((a, index) => ({ passengerId: passengers[index], segmentId, seatNumber: a.seat, passengerType: a.type ?? 'ADULT', cabinClass: a.cabin ?? 'ECONOMY' })) });
    return { bookingId, passengers, ownerId };
  };
  const change = (b: { bookingId: string; ownerId: string }, changes: Array<{ passengerId: string; seatNumber: string; passengerType?: string; cabinClass?: string }>, status: 'PROVISIONAL' | 'CONFIRMED' = 'PROVISIONAL') => seats.change({ bookingId: b.bookingId, ownerId: b.ownerId, newAssignmentStatus: status, changes: changes.map((c) => ({ passengerId: c.passengerId, segmentId, seatNumber: c.seatNumber, passengerType: c.passengerType ?? 'ADULT', cabinClass: c.cabinClass ?? 'ECONOMY' })) });
  const current = async (b: { bookingId: string }) => (await prisma.seatAssignment.findMany({ where: { bookingId: b.bookingId }, orderBy: { passengerId: 'asc' } })).map((row) => ({ p: row.passengerId, seat: row.seatNumber, status: row.status }));

  it('CHG-01 mueve el asiento: informa el anterior, conserva el estado y deja libre el viejo', async () => {
    const a = await booking([{ seat: '1A' }]); await seats.confirm({ bookingId: a.bookingId, ownerId: owner });
    const result = await change(a, [{ passengerId: a.passengers[0], seatNumber: '1B' }]); expect(result).toEqual([{ passengerId: a.passengers[0], segmentId, previousSeatNumber: '1A', seatNumber: '1B', status: 'CONFIRMED' }]);
    const b = await booking([{ seat: '1A' }]); expect((await current(b))[0].seat).toBe('1A');
  });
  it('CHG-02 un cambio a su mismo asiento es válido y no cambia nada', async () => {
    const a = await booking([{ seat: '1C' }]); const result = await change(a, [{ passengerId: a.passengers[0], seatNumber: '1C' }]); expect(result[0]).toMatchObject({ previousSeatNumber: '1C', seatNumber: '1C', status: 'PROVISIONAL' });
  });
  it('CHG-03 dos pasajeros intercambian asientos en una sola operación', async () => {
    const a = await booking([{ seat: '1A' }, { seat: '1B' }]); await change(a, [{ passengerId: a.passengers[0], seatNumber: '1B' }, { passengerId: a.passengers[1], seatNumber: '1A' }]);
    const rows = await prisma.seatAssignment.findMany({ where: { bookingId: a.bookingId } }); const seatOf = (passenger: string) => rows.find((row) => row.passengerId === passenger)?.seatNumber; expect([seatOf(a.passengers[0]), seatOf(a.passengers[1])]).toEqual(['1B', '1A']);
  });
  it('CHG-04 un asiento ocupado por otra reserva responde SEAT_TAKEN y no cambia ninguno de los asientos pedidos', async () => {
    await prisma.seatAssignment.deleteMany({ where: { flightInstanceId: flightId } }); const other = await booking([{ seat: '1C' }]); const a = await booking([{ seat: '1A' }, { seat: '1B' }]); const before = await current(a);
    await expect(change(a, [{ passengerId: a.passengers[0], seatNumber: '1D' }, { passengerId: a.passengers[1], seatNumber: '1C' }])).rejects.toMatchObject({ code: 'SEAT_TAKEN' });
    expect(await current(a)).toEqual(before); expect(other.bookingId).toBeDefined();
  });
  it('CHG-05 un asiento de otra cabina responde SEAT_CABIN_MISMATCH sin cambios', async () => {
    const a = await booking([{ seat: '1A' }]); const before = await current(a);
    await expect(change(a, [{ passengerId: a.passengers[0], seatNumber: '2A' }])).rejects.toMatchObject({ code: 'SEAT_CABIN_MISMATCH' }); expect(await current(a)).toEqual(before);
  });
  it('CHG-06 un infante no puede tener asiento', async () => {
    const a = await booking([{ seat: '1A' }]); await expect(change(a, [{ passengerId: randomUUID(), seatNumber: '1B', passengerType: 'INFANT' }])).rejects.toMatchObject({ code: 'INFANT_SEAT_NOT_ALLOWED' });
  });
  it('CHG-07 después del check-in no se puede cambiar (CUTOFF_PASSED) y el resto de pasajeros no se toca', async () => {
    const a = await booking([{ seat: '1A' }, { seat: '1B' }]); await seats.assignAtCheckIn({ bookingId: a.bookingId, ownerId: owner, passengerId: a.passengers[0], segmentId, passengerType: 'ADULT', cabinClass: 'ECONOMY' }); const before = await current(a);
    await expect(change(a, [{ passengerId: a.passengers[1], seatNumber: '1C' }, { passengerId: a.passengers[0], seatNumber: '1D' }])).rejects.toMatchObject({ code: 'CUTOFF_PASSED' }); expect(await current(a)).toEqual(before);
  });
  it('CHG-08 un pasajero sin asiento recibe uno con el estado indicado', async () => {
    const a = await booking([{ seat: '1A' }]); const extra = randomUUID(); await prisma.seatAssignment.deleteMany({ where: { flightInstanceId: flightId, seatNumber: '1D' } });
    const result = await change(a, [{ passengerId: extra, seatNumber: '1B' }], 'CONFIRMED'); expect(result[0]).toMatchObject({ seatNumber: '1B', status: 'CONFIRMED' }); expect(result[0].previousSeatNumber).toBeUndefined();
  });
  it('CHG-09 un asiento liberado se reactiva con el nuevo asiento', async () => {
    const a = await booking([{ seat: '1A' }]); await seats.release({ bookingId: a.bookingId, ownerId: owner });
    const result = await change(a, [{ passengerId: a.passengers[0], seatNumber: '1B' }], 'CONFIRMED'); expect(result[0]).toMatchObject({ seatNumber: '1B', status: 'CONFIRMED' }); expect(result[0].previousSeatNumber).toBeUndefined();
  });
  it('CHG-10 otro dueño recibe NOT_FOUND y no modifica nada', async () => {
    const a = await booking([{ seat: '1A' }]); const before = await current(a);
    await expect(change({ bookingId: a.bookingId, ownerId: 'otro-dueno' }, [{ passengerId: a.passengers[0], seatNumber: '1B' }])).rejects.toMatchObject({ code: 'NOT_FOUND' }); expect(await current(a)).toEqual(before);
  });
  it('CHG-11 un asiento que no existe en el avión responde SEAT_CABIN_MISMATCH', async () => {
    const a = await booking([{ seat: '1A' }]); await expect(change(a, [{ passengerId: a.passengers[0], seatNumber: '9K' }])).rejects.toMatchObject({ code: 'SEAT_CABIN_MISMATCH' });
  });
  it('CHG-12 la solicitud inválida (duplicados, formato de asiento, sin cambios, de más) responde VALIDATION_FAILED', async () => {
    const a = await booking([{ seat: '1A' }]); const p = a.passengers[0];
    for (const changes of [[{ passengerId: p, seatNumber: '1B' }, { passengerId: p, seatNumber: '1C' }], [{ passengerId: p, seatNumber: 'ZZ' }], [], [{ passengerId: 'no-uuid', seatNumber: '1B' }]]) await rejectsValidation(change(a, changes));
    await rejectsValidation(seats.change({ bookingId: a.bookingId, ownerId: owner, newAssignmentStatus: 'RELEASED', changes: [] }));
  });
  it('CHG-13 dos pasajeros de la misma solicitud al mismo asiento responden SEAT_TAKEN y no cambian nada', async () => {
    const a = await booking([{ seat: '1A' }, { seat: '1B' }]); const before = await current(a);
    await expect(change(a, [{ passengerId: a.passengers[0], seatNumber: '1C' }, { passengerId: a.passengers[1], seatNumber: '1C' }])).rejects.toMatchObject({ code: 'SEAT_TAKEN' }); expect(await current(a)).toEqual(before);
  });
  it('CHG-14 dos reservas que piden a la vez el mismo asiento libre producen un solo éxito', async () => {
    await prisma.seatAssignment.deleteMany({ where: { flightInstanceId: flightId } }); const x = await booking([{ seat: '1A' }]); const y = await booking([{ seat: '1B' }]);
    const results = await Promise.allSettled([change(x, [{ passengerId: x.passengers[0], seatNumber: '1C' }]), change(y, [{ passengerId: y.passengers[0], seatNumber: '1C' }])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(await prisma.seatAssignment.count({ where: { flightInstanceId: flightId, seatNumber: '1C', status: { not: 'RELEASED' } } })).toBe(1);
  });
  it('CHG-15 no deja asientos temporales tras un cambio fallido', async () => {
    await prisma.seatAssignment.deleteMany({ where: { flightInstanceId: flightId } }); const other = await booking([{ seat: '1C' }]); const a = await booking([{ seat: '1A' }]);
    await expect(change(a, [{ passengerId: a.passengers[0], seatNumber: '1C' }])).rejects.toMatchObject({ code: 'SEAT_TAKEN' }); expect(await prisma.seatAssignment.count({ where: { seatNumber: { startsWith: '~' }, bookingId: { in: [a.bookingId, other.bookingId] } } })).toBe(0);
  });
});
