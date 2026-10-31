import { randomUUID } from 'node:crypto';
import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { loadConfig } from '../../../src/config';
import { expectSchema, expectV2Response, fetchToken, registerClient, startTestGateway, type TestGateway } from './support';

const AGREEMENT = '/api/v2/vuelos/promociones/contrato';
const valid = { permite_promociones: true, porcentaje_descuento_maximo: 20, destinos_habilitados: [], rutas_habilitadas: [], cabinas_habilitadas: [] };
const base = { NODE_ENV: 'test', INTERNAL_API_KEY: 'k', JWT_ISSUERS: JSON.stringify([{ iss: 'https://auth.example/auth/v1', aud: 'authenticated', jwksUri: 'https://auth.example/jwks' }]) };

describe('F12a-2 B · observaciones de la auditoría F12 #1 (sin servicios)', () => {
  let gw: TestGateway; let logs = ''; let output: ReturnType<typeof jest.spyOn>;
  beforeAll(async () => {
    output = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { logs += chunk.toString(); return true; }) as typeof process.stdout.write);
    gw = await startTestGateway();
  }, 60_000);
  afterAll(async () => { output?.mockRestore(); await gw?.close(); });
  const put = (body: unknown, headers: Record<string, string> = {}) => request(gw.server).put(AGREEMENT).set('Idempotency-Key', randomUUID()).set(headers).send(body as object);

  describe('PUT /vuelos/promociones/contrato: autenticar y autorizar antes de validar', () => {
    it('V2-B-01 / S: sin token ⇒ 401 aunque el descuento esté fuera de rango', async () => {
      for (const percent of [150, -1, 100.01]) { const res = await put({ ...valid, porcentaje_descuento_maximo: percent }); expect({ percent, status: res.status }).toEqual({ percent, status: 401 }); expectSchema('ProblemDetails', res.body); }
    });
    it('V2-B-02 / S: una cabecera Authorization inválida ⇒ 401 con descuento fuera de rango', async () => {
      for (const authorization of ['Bearer no-es-un-token', 'Basic abc', 'Bearer ']) { const res = await put({ ...valid, porcentaje_descuento_maximo: 150 }, { Authorization: authorization }); expect({ authorization, status: res.status }).toEqual({ authorization, status: 401 }); }
    });
    it('V2-B-03 / S: un token sin el scope flights:admin ⇒ 403 con descuento fuera de rango', async () => {
      const client = await registerClient(gw.store, ['flights:read']); const token = await fetchToken(gw.server, client);
      const res = await put({ ...valid, porcentaje_descuento_maximo: 150 }, { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(403); expectSchema('ProblemDetails', res.body);
    });
    it('V2-B-04 / K: con token admin el descuento fuera de rango sigue siendo 422 PROMOTION_DISCOUNT_OUT_OF_RANGE y uno válido 200', async () => {
      const client = await registerClient(gw.store, ['flights:admin']); const token = await fetchToken(gw.server, client); const headers = { Authorization: `Bearer ${token}` };
      for (const percent of [100.01, 101, -1, -0.5]) { const res = await put({ ...valid, porcentaje_descuento_maximo: percent }, headers); expect({ percent, status: res.status, code: res.body.code }).toEqual({ percent, status: 422, code: 'PROMOTION_DISCOUNT_OUT_OF_RANGE' }); expectV2Response('PUT', '/vuelos/promociones/contrato', 422, res.body); }
      const ok = await put(valid, headers); expect(ok.status).toBe(200); expect(ok.body.contrato.porcentaje_descuento_maximo).toBe(20);
    });
  });

  describe('logs v2: cabeceras sensibles redactadas', () => {
    it('V2-B-05 / S: x-webhook-signature, x-api-key, x-user-id y x-device-fingerprint no aparecen en los logs', async () => {
      const marks = { 'X-Webhook-Signature': `sha256=${randomUUID().replace(/-/g, '')}`, 'X-Api-Key': `key-${randomUUID()}`, 'X-User-Id': `user-${randomUUID()}`, 'X-Device-Fingerprint': `fp-${randomUUID()}` };
      logs = '';
      await request(gw.server).get('/api/v2/vuelos/health').set(marks);
      await request(gw.server).post('/api/v2/vuelos/booking-events').set('Content-Type', 'application/cloudevents+json').set(marks).send('{}');
      await request(gw.server).post('/api/v2/vuelos/search').set(marks).send({ itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2099-01-01' }], passengers: { adults: 1 } });
      // Control: las cabeceras sí se registran (con el valor censurado); lo que no puede quedar es su valor.
      expect(logs).toContain('"x-api-key":"[REDACTED]"');
      for (const [name, value] of Object.entries(marks)) expect({ name, leaked: logs.includes(value) }).toEqual({ name, leaked: false });
    });
  });

  describe('booking-events: BOOKING_EVENTS_CLIENT_ID obligatorio con el endpoint habilitado', () => {
    it('V2-B-06 / S: con BOOKING_EVENTS_SECRET y sin BOOKING_EVENTS_CLIENT_ID la configuración se niega a cargar (fuera de NODE_ENV=test)', () => {
      for (const NODE_ENV of ['production', 'development', undefined]) expect(() => loadConfig({ ...base, NODE_ENV, BOOKING_EVENTS_SECRET: 'secreto-compartido' })).toThrow('BOOKING_EVENTS_CLIENT_ID is required');
      expect(() => loadConfig({ ...base, NODE_ENV: 'production', BOOKING_EVENTS_SECRET: 'secreto-compartido', BOOKING_EVENTS_CLIENT_ID: '' })).toThrow('BOOKING_EVENTS_CLIENT_ID is required');
    });
    it('V2-B-07 / S: con el cliente configurado, o sin secreto (endpoint apagado), arranca', () => {
      expect(loadConfig({ ...base, NODE_ENV: 'production', BOOKING_EVENTS_SECRET: 'secreto-compartido', BOOKING_EVENTS_CLIENT_ID: 'booking' }).v2!.bookingEvents).toMatchObject({ clientId: 'booking' });
      expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).not.toThrow();
      expect(() => loadConfig({ ...base, NODE_ENV: 'development', BOOKING_EVENTS_CLIENT_ID: 'booking' })).not.toThrow();
    });
    it('V2-B-08 / S: el gateway no arranca sin el cliente (createGatewayApp no llega a crearse)', async () => {
      await expect(startTestGateway({ NODE_ENV: 'development', BOOKING_EVENTS_SECRET: 'secreto-compartido', BOOKING_EVENTS_CLIENT_ID: undefined })).rejects.toThrow('BOOKING_EVENTS_CLIENT_ID is required');
    });
  });
});
