import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { afterAll, beforeAll } from '@jest/globals';
import { createDevToken } from '../../../../../infra/scripts/dev-token';
import { expectSchema, expectV2Response } from './support';
import type { Scenario, Stack } from './stack';
import { book, headers, hold, passenger } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;

describeReal('Entrega 3: check-in de Booking desde el panel de la aerolínea', () => {
  let stack: Stack | undefined; let scenario: Scenario | undefined;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  const dir = mkdtempSync(join(tmpdir(), 'booking-check-in-panel-'));
  const publicKeyFile = join(dir, 'public.pem'); writeFileSync(publicKeyFile, keys.publicKey);
  const issuers = JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile }]);
  const admin = `Bearer ${createDevToken(keys.privateKey, { sub: `airline-${randomUUID()}`, app_role: 'admin', scope: 'flights:admin', email_verified: true } as never)}`;
  beforeAll(async () => { const { startStack } = await import('./stack'); stack = await startStack({ JWT_ISSUERS: issuers }); }, 180_000);
  afterAll(async () => { await scenario?.cleanup().catch(() => undefined); await stack?.close(); rmSync(dir, { recursive: true, force: true }); }, 120_000);

  it('la reserva booking~ recibe booking.checked_in con status CONFIRMED en el feed', async () => {
    const current = stack!;
    scenario = await current.scenario({ hoursAhead: 36, clientId: 'booking' });
    const subscription = await current.subscribe(scenario.client.clientId, ['booking.checked_in']);
    const held = await hold(current, scenario, scenario.client, 'u1');
    const booked = await book(current, scenario, scenario.client, 'u1', held, { passengers: [passenger('PAX-1', { assignedSeats: [{ segmentId: held.offer.segmentId, seatNumber: '1A' }] })] });
    expect(booked.response.status).toBe(201);
    const bookingId = booked.response.body.bookingId as string;
    const pnr = booked.response.body.pnr as string;
    const flightPath = `/api/v2/vuelos/flights/${scenario.flightNumber}/status`;
    const passPath = `/api/v2/vuelos/bookings/${bookingId}/boarding-passes`;
    const withoutGate = await request(current.server).get(flightPath).query({ date: scenario.date });
    expect(withoutGate.status).toBe(200); expectV2Response('GET', '/vuelos/flights/{flightNumber}/status', 200, withoutGate.body);
    expect(withoutGate.body.departure.gate).toBeUndefined();
    const stored = await current.db.reservation.reservation.findUniqueOrThrow({ where: { id: bookingId }, select: { ownerId: true } });
    expect(stored.ownerId).toBe('booking~u1');
    const checked = await request(current.server).post('/api/admin/v1/bookings/check-in').set('Authorization', admin).set('Idempotency-Key', randomUUID()).send({ pnr });
    expect(checked.status).toBe(200);
    expect(await current.db.operations.checkIn.findFirstOrThrow({ where: { bookingId, ownerId: stored.ownerId }, select: { eventPublished: true } })).toEqual({ eventPublished: true });
    // En modo bus, publica la outbox del ESB y retira RabbitMQ mediante Webhooks.
    await current.dispatchWebhooks();
    const feedHeaders = await headers(current, scenario.client, 'u1');
    const eventType = 'ec.edu.epn.booking.vuelos.booking.checked_in';
    const deadline = Date.now() + 20_000;
    let event: { id: string; type: string; data: { bookingId: string; pnr: string; status: string; ownerId: string } } | undefined;
    do {
      const feed = await request(current.server).get('/api/v2/vuelos/eventos').query({ type: 'booking.checked_in', limit: 100 }).set(feedHeaders);
      expect(feed.status).toBe(200); expectV2Response('GET', '/vuelos/eventos', 200, feed.body);
      event = feed.body.events.find((value: { type: string; data: { bookingId: string } }) => value.type === eventType && value.data.bookingId === bookingId);
      if (event || Date.now() >= deadline) break;
      await delay(Math.min(500, deadline - Date.now()));
    } while (Date.now() < deadline);
    if (!event) {
      const visible = await request(current.server).get('/api/v2/vuelos/eventos').query({ limit: 100 }).set(feedHeaders);
      expect(visible.status).toBe(200); expectV2Response('GET', '/vuelos/eventos', 200, visible.body);
      const arrived = visible.body.events.filter((value: { data?: { bookingId?: string } }) => value.data?.bookingId === bookingId).map((value: { type: string }) => value.type);
      throw new Error(`booking.checked_in ausente del feed tras 20 s; tipos recibidos para la reserva: ${JSON.stringify(arrived)}`);
    }
    expect(event.data).toMatchObject({ bookingId, pnr, status: 'CONFIRMED', ownerId: 'u1' });
    expectSchema('EventCheckedIn', event);
    const recorded = await current.db.webhooks.event.findUniqueOrThrow({ where: { seq: BigInt(event.id.replace('evt-vue-', '')) } });
    expect(recorded).toMatchObject({ ownerId: 'booking~u1', eventType: 'booking.checked_in' });
    expect(await current.db.webhooks.delivery.count({ where: { eventId: recorded.eventId, subscriptionId: subscription.id } })).toBe(1);
    const passesBefore = await request(current.server).get(passPath).set(await headers(current, scenario.client, 'u1'));
    expect(passesBefore.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}/boarding-passes', 200, passesBefore.body);
    expect(passesBefore.body.boardingPasses[0].gate).toBeUndefined();
    const updated = await request(current.server).patch(flightPath).set(await headers(current, scenario.client, undefined, 'flights:ops')).send({ date: scenario.date, status: 'BOARDING', departureGate: 'A6' });
    expect(updated.status).toBe(200);
    const withGate = await request(current.server).get(flightPath).query({ date: scenario.date });
    expect(withGate.status).toBe(200); expectV2Response('GET', '/vuelos/flights/{flightNumber}/status', 200, withGate.body);
    expect(withGate.body.departure.gate).toBe('A6');
    const passesAfter = await request(current.server).get(passPath).set(await headers(current, scenario.client, 'u1'));
    expect(passesAfter.status).toBe(200); expectV2Response('GET', '/vuelos/bookings/{bookingId}/boarding-passes', 200, passesAfter.body);
    expect(passesAfter.body.boardingPasses[0].gate).toBe('A6');
  }, 180_000);
});
