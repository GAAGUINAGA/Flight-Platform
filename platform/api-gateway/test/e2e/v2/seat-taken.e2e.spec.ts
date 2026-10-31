import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createDevToken } from '../../../../../infra/scripts/dev-token';
import { expectSchema } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, hold, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;

describeReal('F12a · un asiento ocupado responde 409 SEAT_TAKEN en v1 y v2 (no 500)', () => {
  let stack: Stack; let dir: string; let v1Token: (owner: string) => string; const scenarios: Scenario[] = [];
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gateway-seat-')); const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
    const publicKey = join(dir, 'public.pem'); writeFileSync(publicKey, keys.publicKey);
    v1Token = (owner) => `Bearer ${createDevToken(keys.privateKey, { sub: owner, app_role: 'customer', scope: 'flights:read flights:hold flights:book' })}`;
    stack = await startStack({ JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: publicKey }]) });
  }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); rmSync(dir, { recursive: true, force: true }); }, 120_000);

  it('V2-SEAT-01 v2: el segundo pasajero que pide el mismo asiento recibe 409 SEAT_TAKEN y la primera reserva queda intacta', async () => {
    const s = await stack.scenario(); scenarios.push(s); const seat = (segmentId: string) => ({ assignedSeats: [{ segmentId, seatNumber: '1A' }] });
    const first = await hold(stack, s, s.client, 'u1'); const created = await book(stack, s, s.client, 'u1', first, { passengers: [passenger('PAX-1', seat(first.offer.segmentId))] }); expect(created.response.status).toBe(201);
    const second = await hold(stack, s, s.client, 'u2'); const { response } = await book(stack, s, s.client, 'u2', second, { passengers: [passenger('PAX-1', seat(second.offer.segmentId))] });
    expect(response.status).toBe(409); expect(response.body.code).toBe('SEAT_TAKEN'); expectSchema('ProblemDetails', response.body);
    expect(await stack.db.reservation.reservation.findUnique({ where: { id: created.response.body.bookingId }, select: { status: true } })).toEqual({ status: 'CONFIRMED' });
    expect(await stack.db.inventory.cabinInventory.findFirst({ where: { flightInstanceId: s.flightId }, select: { held: true, sold: true } })).toEqual({ held: 1, sold: 1 });
  }, 180_000);

  it('V2-SEAT-02 v1: el mismo caso responde 409 SEAT_TAKEN con el ProblemDetails de v1', async () => {
    const s = await stack.scenario(); scenarios.push(s); const offer = await s.search(); const ownerA = `seat-a-${randomUUID()}`; const ownerB = `seat-b-${randomUUID()}`;
    const makeHold = async (owner: string) => (await request(stack.server).post('/flights/v1/offers/hold').set('Authorization', v1Token(owner)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: { adults: 1 } })).body.holdId as string;
    const makeBooking = (owner: string, holdId: string) => request(stack.server).post('/flights/v1/bookings').set('Authorization', v1Token(owner)).set('Idempotency-Key', randomUUID()).send({ holdId, passengers: [{ passengerId: randomUUID(), passengerType: 'ADULT', firstName: 'Test', lastName: 'Seat', documentType: 'PASSPORT', documentNumber: 'SEAT12345', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'seat@example.invalid', phone: '+593999999999' }, assignedSeats: [{ segmentId: offer.segmentId, seatNumber: '1A' }], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` } });
    try {
      const first = await makeBooking(ownerA, await makeHold(ownerA)); expect(first.status).toBe(201);
      const second = await makeBooking(ownerB, await makeHold(ownerB)); expect(second.status).toBe(409); expect(second.body.code).toBe('SEAT_TAKEN');
    } finally {
      for (const owner of [ownerA, ownerB]) {
        const rows = await stack.db.reservation.reservation.findMany({ where: { ownerId: owner }, select: { id: true } }); const ids = rows.map((row) => row.id); const holds = (await stack.db.inventory.hold.findMany({ where: { ownerId: owner }, select: { id: true } })).map((row) => row.id);
        await stack.db.ancillaries.baggageAllowance.deleteMany({ where: { ownerId: owner } }); await stack.db.ancillaries.seatAssignment.deleteMany({ where: { ownerId: owner } }); await stack.db.ancillaries.bookingOwner.deleteMany({ where: { ownerId: owner } });
        await stack.db.ticketing.issuanceRequest.deleteMany({ where: { bookingId: { in: ids } } }); await stack.db.ticketing.ticket.deleteMany({ where: { ownerId: owner } }); await stack.db.reservation.reservation.deleteMany({ where: { ownerId: owner } });
        await stack.db.pricing.priceLock.deleteMany({ where: { ownerId: owner } }); await stack.db.inventory.reservedInventory.deleteMany({ where: { ownerId: owner } }); await stack.db.inventory.hold.deleteMany({ where: { id: { in: holds } } });
      }
    }
  }, 180_000);
});
