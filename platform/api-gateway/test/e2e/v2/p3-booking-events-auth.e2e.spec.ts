import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { expectSchema, startTestGateway, type TestGateway } from './support';
import { InMemoryV2StateStore } from '../../../src/v2/state';

const SECRET = `shared-${randomUUID()}`;
const event = (data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ specversion: '1.0', type: 'ec.edu.epn.booking.pagos.payment.confirmed', source: '/booking/pagos', id: `evt-${randomUUID()}`, time: new Date().toISOString(), correlationid: 'corr-1', data: { bookingId: randomUUID(), amount: { currency: 'USD', total: '10.00' }, ...data }, ...extra });
const sign = (raw: string, secret = SECRET, prefix = 'sha256=') => `${prefix}${createHmac('sha256', secret).update(raw).digest('hex')}`;
jest.setTimeout(30_000);

describe('F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios)', () => {
  const gateways: TestGateway[] = []; afterEach(async () => { for (const gw of gateways.splice(0)) await gw.close(); });
  const start = async (env: Record<string, string | undefined> = {}) => { const gw = await startTestGateway({ BOOKING_EVENTS_SECRET: SECRET, ...env }); gateways.push(gw); return gw; };
  const post = (gw: TestGateway, raw: string, headers: Record<string, string> = {}, type = 'application/cloudevents+json') => request(gw.server).post('/api/v2/vuelos/booking-events').set('Content-Type', type).set(headers).send(raw);

  it('V2-P3-40 sin secreto configurado el endpoint rechaza todo, incluso una firma calculada con cualquier secreto', async () => {
    const gw = await start({ BOOKING_EVENTS_SECRET: undefined }); const raw = JSON.stringify(event());
    for (const headers of [{}, { 'X-Webhook-Signature': sign(raw) }, { 'X-Webhook-Signature': sign(raw, '') }]) { const res = await post(gw, raw, headers); expect(res.status).toBe(401); expectSchema('ProblemDetails', res.body); expect(res.body.code).toBe('UNAUTHORIZED'); }
  });
  it('V2-P3-41 una firma ausente, con otro secreto, de otro cuerpo, sin prefijo o mal formada responde 401', async () => {
    const gw = await start(); const raw = JSON.stringify(event()); const other = JSON.stringify(event());
    for (const signature of [undefined, sign(raw, 'otro-secreto'), sign(other), createHmac('sha256', SECRET).update(raw).digest('hex'), 'sha256=zz', 'sha256=', `sha1=${'a'.repeat(40)}`, sign(raw).toUpperCase().replace('SHA256=', 'sha256=x')]) {
      const res = await post(gw, raw, signature ? { 'X-Webhook-Signature': signature } : {}); expect({ signature, status: res.status }).toEqual({ signature, status: 401 });
    }
  });
  it('V2-P3-42 la firma se calcula sobre los bytes exactos: cambiar un espacio la invalida', async () => {
    const gw = await start(); const body = event(); const compact = JSON.stringify(body); const spaced = JSON.stringify(body, null, 1);
    expect((await post(gw, spaced, { 'X-Webhook-Signature': sign(compact) })).status).toBe(401);
    const accepted = await post(gw, spaced, { 'X-Webhook-Signature': sign(spaced) }); expect(accepted.status).not.toBe(401);
  });
  it('V2-P3-43 la cabecera y el prefijo de la firma son configurables', async () => {
    const gw = await start({ BOOKING_EVENTS_SIGNATURE_HEADER: 'X-Booking-Signature', BOOKING_EVENTS_SIGNATURE_PREFIX: '' }); const raw = JSON.stringify(event());
    expect((await post(gw, raw, { 'X-Webhook-Signature': sign(raw) })).status).toBe(401); const ok = await post(gw, raw, { 'X-Booking-Signature': sign(raw, SECRET, '') }); expect(ok.status).not.toBe(401);
  });
  it('V2-P3-44 con firma válida un cuerpo que no es CloudEvent responde 400 y un tipo no soportado 422', async () => {
    const gw = await start(); const sendSigned = (value: unknown) => { const raw = typeof value === 'string' ? value : JSON.stringify(value); return post(gw, raw, { 'X-Webhook-Signature': sign(raw) }); };
    for (const bad of ['{"hola":1}', '[]', '"texto"', event({}, { specversion: '0.3' }), { ...event(), id: '' }, { ...event(), correlationid: undefined }]) { const res = await sendSigned(bad as never); expect({ bad, status: res.status }).toEqual({ bad, status: 400 }); expectSchema('ProblemDetails', res.body); }
    const unsupported = await sendSigned({ ...event(), type: 'ec.edu.epn.booking.pagos.payment.refunded' }); expect(unsupported.status).toBe(422);
  });
  it('V2-P3-45 una reserva desconocida responde 404 y no deja el id del evento reclamado', async () => {
    const gw = await start(); const body = event(); const raw = JSON.stringify(body); const first = await post(gw, raw, { 'X-Webhook-Signature': sign(raw) }); expect(first.status).toBe(404);
    const second = await post(gw, raw, { 'X-Webhook-Signature': sign(raw) }); expect(second.status).toBe(404);
  });
  it('V2-P3-46 con BOOKING_EVENTS_CLIENT_ID solo se atienden reservas de ese cliente', async () => {
    const gw = await start({ BOOKING_EVENTS_CLIENT_ID: 'booking' }); const state = gw.app.get<InMemoryV2StateStore>('V2_STATE'); const bookingId = randomUUID();
    await state.saveBooking({ bookingId, clientId: 'otro-cliente', ownerId: 'otro-cliente~u1', holdId: randomUUID(), paymentReference: 'PAY-X', passengerMap: {} });
    const raw = JSON.stringify(event({ bookingId })); const res = await post(gw, raw, { 'X-Webhook-Signature': sign(raw) }); expect(res.status).toBe(404);
  });
  it('V2-P3-47 el endpoint no pide token de partner y un token no sustituye a la firma', async () => {
    const gw = await start(); const raw = JSON.stringify(event()); const res = await post(gw, raw, { Authorization: 'Bearer cualquiera' }); expect(res.status).toBe(401);
  });
  it('V2-P3-48 el secreto no aparece en ninguna respuesta de error', async () => {
    const gw = await start(); const raw = JSON.stringify(event()); const res = await post(gw, raw, { 'X-Webhook-Signature': sign(raw, 'otro') }); expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain(SECRET);
  });
});

