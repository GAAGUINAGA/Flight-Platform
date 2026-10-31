import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { expectV2Response, fetchToken } from './support';
import { startStack, type Scenario, type Stack } from './stack';
import { book, hold } from './flow';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;

describeReal('F12a-2 E · la plataforma sin Booking configurado (contra servicios reales)', () => {
  let stack: Stack; const scenarios: Scenario[] = [];
  beforeAll(async () => { stack = await startStack({ NO_BOOKING_PAYMENTS: 'true' }); }, 180_000);
  afterAll(async () => { for (const value of scenarios) await value.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  it('V2-E-20 / I: buscar y retener funcionan sin ninguna variable de Booking (stock apagado)', async () => {
    const s = await stack.scenario(); scenarios.push(s);
    const held = await hold(stack, s, s.client, 'u1');
    expect(held.holdId).toBeTruthy();
    const health = await request(stack.server).get('/api/v2/vuelos/health'); expect([200, 503]).toContain(health.status);
  }, 120_000);

  it('V2-E-21 / S: con un cliente client_credentials el pago responde 503 PROVIDER_UNAVAILABLE y no se crea la reserva ni se llama a Booking', async () => {
    const s = await stack.scenario(); scenarios.push(s);
    const held = await hold(stack, s, s.client, 'u1');
    const { response } = await book(stack, s, s.client, 'u1', held, { confirm: false });
    expect(response.status).toBe(503); expect(response.body.code).toBe('PROVIDER_UNAVAILABLE'); expect(response.headers['retry-after']).toBeDefined();
    expectV2Response('POST', '/vuelos/bookings', 503, response.body);
    expect(stack.payments.requests).toHaveLength(0);
    const mine = await request(stack.server).get('/api/v2/vuelos/bookings').set('Authorization', `Bearer ${await fetchToken(stack.server, s.client)}`).set('X-User-Id', 'u1');
    expect(mine.status).toBe(200); expect(mine.body.items ?? mine.body).toHaveLength(0);
  }, 120_000);

  it('V2-E-22 / S: booking-events rechaza todo sin secreto configurado', async () => {
    const raw = JSON.stringify({ specversion: '1.0', type: 'ec.edu.epn.booking.pagos.payment.confirmed', source: '/booking', id: `evt-${randomUUID()}`, time: new Date().toISOString(), correlationid: 'c', data: { bookingId: randomUUID() } });
    const res = await request(stack.server).post('/api/v2/vuelos/booking-events').set('Content-Type', 'application/cloudevents+json').set('X-Webhook-Signature', 'sha256=' + 'a'.repeat(64)).send(raw);
    expect(res.status).toBe(401);
  }, 60_000);
});
