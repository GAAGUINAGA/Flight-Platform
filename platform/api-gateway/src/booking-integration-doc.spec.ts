/* global __dirname */
import { randomUUID, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { parse } from 'yaml';
import { WebhookUseCases } from '../../../microservices/webhooks-service/src/application/webhook-use-cases';
import type { HttpPoster, UrlPolicy, WebhookStore } from '../../../microservices/webhooks-service/src/application/ports';
import type { Delivery, Subscription, WebhookPayload } from '../../../microservices/webhooks-service/src/domain/webhook';
import { AesGcmCipher } from '../../../microservices/webhooks-service/src/infrastructure/security/webhook-security';
import { verifyFlightSignature } from '../../../docs/booking-integration/verify-webhook-signature';
import { PUBLIC_PROBLEM_CODES, problemFor } from './errors';
import { openApiSpecPath } from './openapi-path';

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const guide = read('docs/booking-integration.md');

class Store {
  subscriptions: Subscription[] = []; deliveries: Delivery[] = [];
  async createSubscription(input: Subscription) { this.subscriptions.push(input); return input; }
  async activeFor(ownerId: string, eventType: string) { return this.subscriptions.filter((item) => item.ownerId === ownerId && item.active && item.events.includes(eventType as never)); }
  async getSubscription(id: string) { return this.subscriptions.find((item) => item.id === id) ?? null; }
  async createDeliveries(eventId: string, payload: WebhookPayload, ids: string[], at: Date) { this.deliveries.push(...ids.map((subscriptionId) => ({ id: randomUUID(), eventId, subscriptionId, payload, status: 'PENDING' as const, attempts: 0, nextAttemptAt: at }))); }
  async claimPending() { return this.deliveries.map((item) => ({ ...item, status: 'PROCESSING' as const })); }
  async delivered() { return undefined; }
  async failed() { return undefined; }
}

describe('PLT-J1: la guía de integración coincide con el sistema', () => {
  const now = new Date('2026-10-07T12:00:00.000Z');
  const secret = 'integration-secret-1234';
  const context = { ownerId: 'partner-1', role: 'system', correlationId: 'doc' };

  /** Entrega un evento con el despachador real de Webhooks y devuelve lo que recibiría el consumidor. */
  const delivered = async () => {
    const sent: Array<{ body: string; headers: Record<string, string> }> = [];
    const poster: HttpPoster = { post: jest.fn(async (_url: string, body: string, headers: Record<string, string>) => { sent.push({ body, headers }); return 200; }) } as unknown as HttpPoster;
    const policy: UrlPolicy = { assertSafe: jest.fn(async () => undefined) } as unknown as UrlPolicy;
    const useCases = new WebhookUseCases(new Store() as unknown as WebhookStore, policy, new AesGcmCipher(Buffer.alloc(32, 7).toString('base64')), poster, { timeoutMs: 5000, backoffMinutes: [1, 5, 15, 60, 180, 720], production: false }, () => now);
    await useCases.create(context, { ownerId: 'partner-1', url: 'https://hooks.example.test/flight', events: ['hold.expired'], secret });
    await useCases.publish(context, { ownerId: 'partner-1', payload: { eventType: 'hold.expired', data: { holdId: randomUUID(), status: 'EXPIRED' } } });
    await useCases.dispatch(context, {});
    return sent[0];
  };
  const seconds = Math.floor(now.getTime() / 1000);

  it('J1-01: el ejemplo TypeScript acepta la firma que emite el despachador real de Webhooks', async () => {
    const { body, headers } = await delivered();
    expect(headers['x-flight-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyFlightSignature(body, headers['x-flight-signature'], secret, { nowSeconds: seconds })).toBe(true);
    expect(JSON.parse(body).data).toMatchObject({ status: 'EXPIRED', holdId: expect.any(String) });
  });
  it('J1-02: el ejemplo rechaza cuerpo alterado, secreto equivocado, marca antigua y cabeceras mal formadas', async () => {
    const { body, headers } = await delivered(); const header = headers['x-flight-signature'];
    expect(verifyFlightSignature(`${body} `, header, secret, { nowSeconds: seconds })).toBe(false);
    expect(verifyFlightSignature(body, header, 'otro-secreto', { nowSeconds: seconds })).toBe(false);
    expect(verifyFlightSignature(body, header, secret, { nowSeconds: seconds + 301 })).toBe(false);
    expect(verifyFlightSignature(body, header, secret, { nowSeconds: seconds + 300 })).toBe(true);
    for (const malformed of [undefined, '', 'v1=abc', `t=${seconds}`, `t=x,v1=${'a'.repeat(64)}`, `t=${seconds},v1=${'a'.repeat(63)}`, `t=${seconds},v1=${'A'.repeat(64)}`]) expect(verifyFlightSignature(body, malformed, secret, { nowSeconds: seconds })).toBe(false);
    const forged = `t=${seconds},v1=${createHmac('sha256', 'otro').update(`${seconds}.${body}`).digest('hex')}`;
    expect(verifyFlightSignature(body, forged, secret, { nowSeconds: seconds })).toBe(false);
  });
  it('J1-03: la guía incluye el ejemplo tal cual está en el archivo probado', () => {
    expect(guide).toContain(read('docs/booking-integration/verify-webhook-signature.ts').trimEnd());
  });
  it.each([...PUBLIC_PROBLEM_CODES])('J1-04: la guía documenta %s con su estado HTTP', (code) => {
    const row = guide.split('\n').find((line) => line.startsWith(`| \`${code}\` |`));
    expect(row).toBeDefined();
    expect(row!.split('|')[2]).toContain(String(problemFor(code).status));
    if (code === 'OFFER_NO_LONGER_AVAILABLE') expect(row).toContain(String(problemFor(code, 'booking').status));
  });
  it('J1-05: la guía documenta el 503 con RATE_LIMIT_EXCEEDED y Retry-After, y las referencias de pago simuladas', () => {
    expect(problemFor('RATE_LIMIT_EXCEEDED').status).toBe(429);
    expect(guide).toMatch(/503[^\n]*Retry-After: 5/);
    for (const prefix of ['pay_ok_', 'pay_pending_', 'pay_denied_']) expect(guide).toContain(prefix);
    expect(guide).toContain('data.holdId');
    expect(guide).toMatch(/suspende/);
  });
  it('J1-06: la guía lista las 22 operaciones REST del contrato y el callback', () => {
    const paths = (parse(readFileSync(openApiSpecPath(), 'utf8')) as { paths: Record<string, Record<string, unknown>> }).paths;
    const operations = Object.entries(paths).flatMap(([path, methods]) => Object.keys(methods).filter((method) => ['get', 'post', 'put', 'delete'].includes(method)).map((method) => `${method.toUpperCase()} ${path}`));
    expect(operations).toHaveLength(22);
    for (const operation of operations) expect(guide).toContain(`\`${operation.replace(/^GET (\/flights\/\{flightNumber\}\/status)$/, 'GET $1?date=').replace(/^GET (\/offers\/\{offerId\}\/seatmap)$/, 'GET $1?segmentId=')}\``);
    for (let index = 1; index <= 23; index++) expect(guide).toContain(`| OP-${String(index).padStart(2, '0')} |`);
  });
});

describe('PLT-J1: la colección de Postman cubre el contrato y no lleva secretos', () => {
  type Item = { name: string; item?: Item[]; request?: { method: string; url: { raw: string }; header?: Array<{ key: string; value: string }> } };
  const collection = JSON.parse(read('docs/booking-integration/flight-platform.postman_collection.json')) as { item: Item[] };
  const environment = JSON.parse(read('docs/booking-integration/render.postman_environment.json')) as { values: Array<{ key: string; value: string; type?: string }> };
  const flat = (items: Item[]): Item[] => items.flatMap((item) => (item.item ? flat(item.item) : [item]));
  const normalize = (value: string) => value.replace(/^\{\{baseUrl\}\}\/flights\/v1/, '').replace(/\?.*$/, '').replace(/\{\{[^}]+\}\}|\{[^}]+\}/g, '{}');

  it('J1-07: la colección tiene una petición por cada operación del contrato (método y ruta)', () => {
    const paths = (parse(readFileSync(openApiSpecPath(), 'utf8')) as { paths: Record<string, Record<string, unknown>> }).paths;
    const expected = Object.entries(paths).flatMap(([path, methods]) => Object.keys(methods).filter((method) => ['get', 'post', 'put', 'delete'].includes(method)).map((method) => `${method.toUpperCase()} ${normalize(path)}`)).sort();
    const requests = flat(collection.item).filter((item) => /^OP-\d+ /.test(item.name) && item.request!.url.raw.startsWith('{{baseUrl}}'));
    expect(requests.map((item) => `${item.request!.method} ${normalize(item.request!.url.raw)}`).sort()).toEqual(expected);
    expect(requests.map((item) => item.name.slice(0, 5)).sort()).toEqual(Array.from({ length: 22 }, (_, index) => `OP-${String(index + 1).padStart(2, '0')}`));
    expect(flat(collection.item).some((item) => item.name.startsWith('OP-23'))).toBe(true);
  });
  it('J1-08: las operaciones con Idempotency-Key del contrato la envían y las protegidas usan el token del entorno', () => {
    const idempotent = ['OP-03', 'OP-07', 'OP-10', 'OP-12', 'OP-14'];
    for (const item of flat(collection.item).filter((entry) => /^OP-\d+ /.test(entry.name) && entry.request!.url.raw.startsWith('{{baseUrl}}'))) {
      const has = Boolean(item.request!.header?.some((entry) => entry.key === 'Idempotency-Key'));
      expect({ id: item.name.slice(0, 5), has }).toEqual({ id: item.name.slice(0, 5), has: idempotent.includes(item.name.slice(0, 5)) });
    }
    expect((collection as unknown as { auth: { bearer: Array<{ value: string }> } }).auth.bearer[0].value).toBe('{{accessToken}}');
  });
  it('J1-09: ni la colección ni el entorno contienen tokens, claves o secretos', () => {
    const text = `${read('docs/booking-integration/flight-platform.postman_collection.json')}${read('docs/booking-integration/render.postman_environment.json')}`;
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/-----BEGIN/);
    for (const key of ['accessToken', 'webhookSecret']) expect(environment.values.find((entry) => entry.key === key)?.value).toBe('');
  });
});
