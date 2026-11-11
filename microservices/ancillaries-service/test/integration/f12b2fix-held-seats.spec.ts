import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaSeatMapStore } from '../../src/infrastructure/persistence/prisma-seat-map';
import { PrismaSeatAssignmentStore } from '../../src/infrastructure/persistence/prisma-seat-assignments';
import { PrismaBookingOwnershipStore } from '../../src/infrastructure/persistence/prisma-booking-ownership';
import { table } from '../../src/infrastructure/persistence/schema';
import { SeatAssignments } from '../../src/application/seat-assignments';
import { GetSeatMapForOffer } from '../../src/application/seat-map';

describe('F12b2fix: asientos apartados por un hold contra PostgreSQL', () => {
  let prisma: PrismaClient; let seats: SeatAssignments; let seatMap: GetSeatMapForOffer;
  const aircraft = `HLD${randomUUID().replace(/-/g, '').slice(0, 12)}`; const flightId = randomUUID(); const segmentId = randomUUID(); const owner = `hold-owner-${randomUUID().slice(0, 8)}`; const bookings: string[] = [];
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Ancillaries integration tests');
    prisma = new PrismaClient(); await prisma.$connect();
    for (const [index, seatNumber] of ['1A', '1B', '1C', '1D'].entries()) await prisma.seatLayout.create({ data: { aircraft, cabinClass: 'ECONOMY', seatNumber, rowNumber: 1, characteristics: index === 3 ? ['EMERGENCY_EXIT'] : ['WINDOW'] } });
    const store = new PrismaSeatAssignmentStore(prisma); const layouts = new PrismaSeatMapStore(prisma);
    const pricing = { resolveSegment: async () => ({ segmentId, flightInstanceId: flightId, aircraft }), getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) };
    seats = new SeatAssignments(pricing, layouts, store, new PrismaBookingOwnershipStore(prisma), store, store);
    seatMap = new GetSeatMapForOffer(pricing, layouts, layouts);
  }, 60_000);
  beforeEach(async () => { await prisma.seatAssignment.deleteMany({ where: { flightInstanceId: flightId } }); });
  afterAll(async () => {
    try { if (prisma) { await prisma.seatAssignment.deleteMany({ where: { flightInstanceId: flightId } }); await prisma.$executeRaw`DELETE FROM ${table('booking_owners')} WHERE "booking_id" = ANY(${bookings}::uuid[])`; await prisma.seatLayout.deleteMany({ where: { aircraft } }); } } finally { await prisma?.$disconnect(); }
  });

  const expiresIn = (ms: number) => new Date(Date.now() + ms).toISOString();
  const hold = (holdId: string, seatNumbers: string[], ownerId = owner, expiresAt = expiresIn(600_000)) => seats.holdSeats({ holdId, ownerId, expiresAt, seats: seatNumbers.map((seatNumber) => ({ segmentId, seatNumber })) });
  const reserve = (bookingId: string, holdId: string | undefined, seatNumbers: string[], ownerId = owner) => { bookings.push(bookingId); return seats.reserve({ bookingId, ownerId, ...(holdId ? { holdId } : {}), assignments: seatNumbers.map((seatNumber) => ({ passengerId: randomUUID(), segmentId, seatNumber, passengerType: 'ADULT', cabinClass: 'ECONOMY' })) }); };
  const statuses = async () => Object.fromEntries((await seatMap.execute({ offerId: randomUUID(), segmentId })).cabins[0].rows[0].seats.map((seat) => [seat.seatNumber, seat.status ?? 'AVAILABLE']));
  const available = async () => Object.fromEntries((await seatMap.execute({ offerId: randomUUID(), segmentId })).cabins[0].rows[0].seats.map((seat) => [seat.seatNumber, seat.isAvailable]));

  it('H-01 (escenario Booking 1): hold con asiento; el mismo asiento en otro hold da SEAT_TAKEN y no deja filas', async () => {
    const first = randomUUID(); const second = randomUUID();
    await hold(first, ['1A']);
    await expect(hold(second, ['1B', '1A'])).rejects.toMatchObject({ code: 'SEAT_TAKEN' });
    expect(await prisma.seatAssignment.count({ where: { holdId: second } })).toBe(0);
    expect(await statuses()).toEqual({ '1A': 'HELD', '1B': 'AVAILABLE', '1C': 'AVAILABLE', '1D': 'AVAILABLE' });
  });
  it('H-02 (escenario Booking 2): el mapa muestra HELD con isAvailable false y al liberar vuelve a AVAILABLE', async () => {
    const id = randomUUID(); await hold(id, ['1B']);
    expect(await statuses()).toMatchObject({ '1B': 'HELD' }); expect(await available()).toMatchObject({ '1B': false });
    await seats.releaseHeld({ holdId: id, ownerId: owner });
    expect(await statuses()).toMatchObject({ '1B': 'AVAILABLE' }); expect(await available()).toMatchObject({ '1B': true });
  });
  it('H-03 (escenario Booking 3): reserva → PROVISIONAL, confirmación → CONFIRMED y check-in → CHECKED_IN', async () => {
    const bookingId = randomUUID(); const passengerId = randomUUID(); bookings.push(bookingId);
    await seats.reserve({ bookingId, ownerId: owner, assignments: [{ passengerId, segmentId, seatNumber: '1C', passengerType: 'ADULT', cabinClass: 'ECONOMY' }] });
    expect(await statuses()).toMatchObject({ '1C': 'PROVISIONAL' });
    await seats.confirm({ bookingId, ownerId: owner }); expect(await statuses()).toMatchObject({ '1C': 'CONFIRMED' });
    await seats.assignAtCheckIn({ bookingId, ownerId: owner, passengerId, segmentId, passengerType: 'ADULT', cabinClass: 'ECONOMY' });
    expect(await statuses()).toMatchObject({ '1C': 'CHECKED_IN' }); expect(await available()).toMatchObject({ '1C': false });
  });
  it('H-04: el vencimiento sin liberación explícita ni scheduler: el mapa lo ve libre sin escribir y otro hold lo toma', async () => {
    const id = randomUUID(); await hold(id, ['1A']);
    await prisma.seatAssignment.updateMany({ where: { holdId: id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect(await statuses()).toMatchObject({ '1A': 'AVAILABLE' });
    expect((await prisma.seatAssignment.findFirst({ where: { holdId: id } }))?.status).toBe('HELD'); // la lectura no escribe
    const other = randomUUID(); await hold(other, ['1A'], 'otro-dueno');
    expect(await statuses()).toMatchObject({ '1A': 'HELD' });
    expect((await prisma.seatAssignment.findFirst({ where: { holdId: id } }))?.status).toBe('RELEASED'); // quien aparta libera la vencida
    await prisma.seatAssignment.updateMany({ where: { holdId: other }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await expect(reserve(randomUUID(), undefined, ['1A'])).resolves.toHaveLength(1); // y también quien reserva
  });
  it('H-05 (carrera): dos holds simultáneos sobre el mismo asiento: solo uno gana, el otro SEAT_TAKEN', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => hold(randomUUID(), ['1B'])));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'SEAT_TAKEN' });
    expect(await prisma.seatAssignment.count({ where: { flightInstanceId: flightId, seatNumber: '1B', status: { not: 'RELEASED' } } })).toBe(1);
  });
  it('H-06 (carrera): un hold y una reserva real compiten por el mismo asiento: uno solo', async () => {
    const results = await Promise.allSettled([hold(randomUUID(), ['1C']), reserve(randomUUID(), undefined, ['1C']), hold(randomUUID(), ['1C'])]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('H-07 (hold → reserva) mismos asientos: pasan de HELD a vendidos sin 409 contra su propio hold', async () => {
    const id = randomUUID(); await hold(id, ['1A', '1B']);
    const bookingId = randomUUID(); await reserve(bookingId, id, ['1A', '1B']);
    expect(await statuses()).toMatchObject({ '1A': 'PROVISIONAL', '1B': 'PROVISIONAL' });
    expect(await prisma.seatAssignment.count({ where: { holdId: id, status: 'HELD' } })).toBe(0);
  });
  it('H-08 (hold → reserva) ninguno: el hold sin asientos nuevos se libera por completo', async () => {
    const id = randomUUID(); await hold(id, ['1A']); await reserve(randomUUID(), id, []);
    expect(await statuses()).toMatchObject({ '1A': 'AVAILABLE' });
  });
  it('H-09 (hold → reserva) otros: se liberan los del hold y se toman los nuevos; si uno está ocupado SEAT_TAKEN y el hold queda intacto', async () => {
    const id = randomUUID(); await hold(id, ['1A']); await reserve(randomUUID(), undefined, ['1C']);
    await expect(reserve(randomUUID(), id, ['1C'])).rejects.toMatchObject({ code: 'SEAT_TAKEN' });
    expect(await statuses()).toMatchObject({ '1A': 'HELD', '1C': 'PROVISIONAL' });
    await reserve(randomUUID(), id, ['1B']);
    expect(await statuses()).toMatchObject({ '1A': 'AVAILABLE', '1B': 'PROVISIONAL', '1C': 'PROVISIONAL' });
  });
  it('H-10 (compensación) si la reserva falla después de tomar los asientos, releaseAll con restoreHold los devuelve al hold', async () => {
    const id = randomUUID(); await hold(id, ['1A']); const bookingId = randomUUID(); await reserve(bookingId, id, ['1B']);
    expect(await statuses()).toMatchObject({ '1A': 'AVAILABLE', '1B': 'PROVISIONAL' });
    await seats.release({ bookingId, ownerId: owner, restoreHold: true });
    expect(await statuses()).toMatchObject({ '1A': 'HELD', '1B': 'AVAILABLE' });
    expect(await seats.heldSeats({ holdId: id, ownerId: owner })).toEqual({ seats: [{ segmentId, seatNumber: '1A' }] });
  });
  it('H-11 (compensación) un asiento que otro ya tomó no se devuelve y no impide devolver los demás', async () => {
    const id = randomUUID(); await hold(id, ['1A', '1B']); const bookingId = randomUUID(); await reserve(bookingId, id, ['1C']);
    await seats.release({ bookingId, ownerId: owner });
    await reserve(randomUUID(), undefined, ['1A']);
    await seats.release({ bookingId, ownerId: owner, restoreHold: true });
    expect(await statuses()).toMatchObject({ '1A': 'PROVISIONAL', '1B': 'HELD' });
  });
  it('H-12 (propiedad) otro dueño no puede liberar ni convertir un hold ajeno ni verlo', async () => {
    const id = randomUUID(); await hold(id, ['1A']);
    await seats.releaseHeld({ holdId: id, ownerId: 'intruso' });
    expect(await seats.heldSeats({ holdId: id, ownerId: 'intruso' })).toEqual({ seats: [] });
    await expect(reserve(randomUUID(), id, ['1B'], 'intruso')).resolves.toHaveLength(1);
    expect(await statuses()).toMatchObject({ '1A': 'HELD', '1B': 'PROVISIONAL' });
  });
  it('H-13: la fila apartada es inconfundible con una reserva (bookingId = holdId, passengerId sintético, sin booking_owners) y no cuenta como check-in', async () => {
    const id = randomUUID(); await hold(id, ['1A']);
    const row = await prisma.seatAssignment.findFirstOrThrow({ where: { holdId: id } });
    expect(row).toMatchObject({ status: 'HELD', bookingId: id }); expect(row.passengerId.slice(0, 24)).toBe(id.slice(0, 24));
    await expect(seats.assignments({ bookingId: id, ownerId: owner })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.seatAssignment.count({ where: { holdId: id, status: 'CHECKED_IN' } })).toBe(0);
  });
  it('H-14: changeSeats a un asiento apartado por un hold vigente da SEAT_TAKEN; si el hold venció, lo toma', async () => {
    const id = randomUUID(); await hold(id, ['1B']);
    const bookingId = randomUUID(); const passengerId = randomUUID(); bookings.push(bookingId);
    await seats.reserve({ bookingId, ownerId: owner, assignments: [{ passengerId, segmentId, seatNumber: '1A', passengerType: 'ADULT', cabinClass: 'ECONOMY' }] });
    const move = () => seats.change({ bookingId, ownerId: owner, newAssignmentStatus: 'PROVISIONAL', changes: [{ passengerId, segmentId, seatNumber: '1B', passengerType: 'ADULT', cabinClass: 'ECONOMY' }] });
    await expect(move()).rejects.toMatchObject({ code: 'SEAT_TAKEN' });
    await prisma.seatAssignment.updateMany({ where: { holdId: id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await expect(move()).resolves.toHaveLength(1);
  });
});
