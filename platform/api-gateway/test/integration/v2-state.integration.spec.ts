import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PrismaClient } from '../../generated/prisma-client';
import { hashClientSecret, verifyClientSecret } from '../../src/v2/dev-auth';
import { PrismaDevAuthClientStore } from '../../src/v2/prisma-dev-auth-store';
import { PrismaV2StateStore } from '../../src/v2/state';

describe('F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres', () => {
  const prisma = new PrismaClient(); const state = new PrismaV2StateStore(prisma); const clients = new PrismaDevAuthClientStore(prisma);
  const run = `it-${randomUUID().slice(0, 8)}`; const bookingIds: string[] = []; let connected = false;
  beforeAll(async () => { await prisma.$connect(); connected = true; });
  afterAll(async () => {
    if (connected) { await prisma.v2Booking.deleteMany({ where: { bookingId: { in: bookingIds } } }); await prisma.v2ProcessedEvent.deleteMany({ where: { clientId: { startsWith: run } } }); await prisma.devAuthClient.deleteMany({ where: { clientId: { startsWith: run } } }); }
    await prisma.$disconnect();
  });
  const record = (overrides: Partial<Parameters<PrismaV2StateStore['saveBooking']>[0]> = {}) => { const bookingId = randomUUID(); bookingIds.push(bookingId); return { bookingId, clientId: `${run}-a`, ownerId: `${run}-a~u1`, holdId: randomUUID(), paymentReference: `PAY-${randomUUID()}`, passengerMap: { [randomUUID()]: 'PAX-1' }, ...overrides }; };

  it('V2-STATE-01 guarda y lee la reserva v2 con sus ids de pasajero y canal de venta', async () => {
    const value = record({ salesChannel: { partnerOrderId: 'ORD-1', packageId: null } }); await state.saveBooking(value);
    expect(await state.findBooking(value.bookingId)).toEqual(value);
  });
  it('V2-STATE-02 guardar dos veces la misma reserva actualiza sin duplicar (repara un reintento)', async () => {
    const value = record(); await state.saveBooking(value); await state.saveBooking({ ...value, passengerMap: { x: 'PAX-9' } });
    expect((await state.findBooking(value.bookingId))?.passengerMap).toEqual({ x: 'PAX-9' }); expect(await prisma.v2Booking.count({ where: { bookingId: value.bookingId } })).toBe(1);
  });
  it('V2-STATE-03 busca por referencia de pago solo dentro del cliente', async () => {
    const value = record(); await state.saveBooking(value);
    expect((await state.findBookingByPayment(value.clientId, value.paymentReference))?.bookingId).toBe(value.bookingId); expect(await state.findBookingByPayment(`${run}-otro`, value.paymentReference)).toBeNull();
  });
  it('V2-STATE-04 una reserva inexistente devuelve null', async () => { expect(await state.findBooking(randomUUID())).toBeNull(); });
  it('V2-STATE-05 un evento de Booking se reclama una sola vez, también en concurrencia', async () => {
    const id = `evt-${randomUUID()}`; const results = await Promise.all(Array.from({ length: 5 }, () => state.claimEvent(`${run}-a`, id, 'payment.confirmed')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('V2-STATE-06 el resultado del evento se guarda y se lee; el mismo id de otro cliente es independiente', async () => {
    const id = `evt-${randomUUID()}`; await state.claimEvent(`${run}-a`, id, 'payment.failed'); expect(await state.eventOutcome(`${run}-a`, id)).toBeNull();
    await state.completeEvent(`${run}-a`, id, 'FAILED_APPLIED'); expect(await state.eventOutcome(`${run}-a`, id)).toBe('FAILED_APPLIED'); expect(await state.claimEvent(`${run}-b`, id, 'payment.failed')).toBe(true);
  });
  it('V2-STATE-07 liberar un evento sin resultado permite reclamarlo de nuevo y uno ya resuelto no se libera', async () => {
    const pending = `evt-${randomUUID()}`; await state.claimEvent(`${run}-a`, pending, 'payment.confirmed'); await state.releaseEvent(`${run}-a`, pending); expect(await state.claimEvent(`${run}-a`, pending, 'payment.confirmed')).toBe(true);
    const done = `evt-${randomUUID()}`; await state.claimEvent(`${run}-a`, done, 'payment.confirmed'); await state.completeEvent(`${run}-a`, done, 'ISSUED'); await state.releaseEvent(`${run}-a`, done); expect(await state.claimEvent(`${run}-a`, done, 'payment.confirmed')).toBe(false);
  });
  it('V2-STATE-08 el cliente del dev-auth se guarda con el hash del secreto y se activa o desactiva', async () => {
    const clientId = `${run}-client`; const secret = `secret-${randomUUID()}`; await clients.create({ clientId, secretHash: await hashClientSecret(secret), scopes: ['flights:read'], active: true, name: 'integración' });
    const found = await clients.find(clientId); expect(found).toMatchObject({ clientId, scopes: ['flights:read'], active: true }); expect(JSON.stringify(await prisma.devAuthClient.findUnique({ where: { clientId } }))).not.toContain(secret);
    expect(await verifyClientSecret(secret, found!.secretHash)).toBe(true); expect(await verifyClientSecret('otro-secreto-distinto', found!.secretHash)).toBe(false);
    await clients.setActive(clientId, false); expect((await clients.find(clientId))?.active).toBe(false);
  });
  it('V2-STATE-09 no se puede crear dos veces el mismo clientId', async () => {
    const clientId = `${run}-dup`; const base = { clientId, secretHash: 'scrypt$x', scopes: ['flights:read'], active: true }; await clients.create(base); await expect(clients.create(base)).rejects.toBeDefined();
  });
});
