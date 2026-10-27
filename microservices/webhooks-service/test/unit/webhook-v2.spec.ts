import { createHmac, randomUUID } from 'node:crypto'; import { Buffer } from 'node:buffer';
import { WebhookUseCases } from '../../src/application/webhook-use-cases';
import { EventLog, HttpPoster, UrlPolicy, WebhookStore } from '../../src/application/ports';
import { Delivery, StoredEvent, Subscription, WebhookPayload, cloudEventId, subscriberOwners, v1Body } from '../../src/domain/webhook';
import { AesGcmCipher, WebhookUrlPolicy } from '../../src/infrastructure/security/webhook-security';
import { createWebhooksServer } from '../../src/infrastructure/grpc/server';

/* global beforeEach */
const key = Buffer.alloc(32, 7).toString('base64'); const now = new Date('2026-10-26T15:00:00.000Z'); const ctx = { ownerId: 'x', role: 'system', correlationId: 'test' };
class Memory implements WebhookStore, EventLog {
  subscriptions: Subscription[] = []; deliveries: Delivery[] = []; events: StoredEvent[] = [];
  async createSubscription(input: Subscription) { this.subscriptions.push(input); return input; }
  async listSubscriptions(ownerId: string) { return this.subscriptions.filter((s) => s.ownerId === ownerId); }
  async deleteSubscription() { return true; }
  async activeFor(ownerId: string, eventType: string) { const owners = subscriberOwners(ownerId); return this.subscriptions.filter((s) => owners.includes(s.ownerId) && s.active && s.events.includes(eventType as never)); }
  async getSubscription(id: string) { return this.subscriptions.find((s) => s.id === id) ?? null; }
  async createDeliveries(eventId: string, payload: WebhookPayload, ids: string[], at: Date) { this.deliveries.push(...ids.map((subscriptionId) => ({ id: randomUUID(), eventId, subscriptionId, payload, status: 'PENDING' as const, attempts: 0, nextAttemptAt: at }))); }
  async claimPending(at: Date) { return this.deliveries.filter((d) => d.status === 'PENDING' && d.nextAttemptAt <= at); }
  async delivered(id: string) { this.deliveries.find((d) => d.id === id)!.status = 'DELIVERED'; }
  async failed() { /* no aplica */ }
  async recordEvent(input: { eventId: string; ownerId: string; eventType: string; occurredAt: Date; apiVersion: string; correlationId?: string; data: Record<string, unknown> }) { const found = this.events.find((e) => e.eventId === input.eventId); if (found) return found.seq; const seq = this.events.length + 42; this.events.push({ seq, eventId: input.eventId, ownerId: input.ownerId, eventType: input.eventType, occurredAt: input.occurredAt.toISOString(), apiVersion: input.apiVersion, ...(input.correlationId ? { correlationId: input.correlationId } : {}), data: input.data }); return seq; }
  async listEvents(input: { ownerPrefix: string; afterSeq?: number; limit: number; eventType?: string }) { const items = this.events.filter((e) => (e.ownerId === input.ownerPrefix || e.ownerId.startsWith(`${input.ownerPrefix}~`)) && (!input.afterSeq || e.seq > input.afterSeq) && (!input.eventType || e.eventType === input.eventType)); return { items: items.slice(0, input.limit), total: items.length }; }
}
const allow: UrlPolicy = { assertSafe: async () => undefined }; const cipher = new AesGcmCipher(key);

describe('F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos', () => {
  let store: Memory; let poster: HttpPoster & { post: jest.Mock }; let useCases: WebhookUseCases;
  beforeEach(() => { store = new Memory(); poster = { post: jest.fn().mockResolvedValue(204) }; useCases = new WebhookUseCases(store, allow, cipher, poster, { timeoutMs: 5000, backoffMinutes: [1, 5, 15], production: false, sourceCode: 'gabatair' }, () => now, store); });
  const subscribe = (owner: string, events: string[], apiVersion?: '1' | '2', secret = 'secret-de-prueba-123') => useCases.create(ctx, { ownerId: owner, url: 'https://hooks.example.test/h', events, secret, ...(apiVersion ? { apiVersion } : {}) });
  const publish = (owner: string, payload: Record<string, unknown>) => useCases.publish(ctx, { ownerId: owner, payload });

  it('WHK-V2-01: una suscripción v2 informa active y la v1 conserva su forma de siempre', async () => {
    const v2 = await subscribe('client-a', ['booking.confirmed'], '2'); const v1 = await subscribe('client-b', ['booking.confirmed']);
    expect(v2).toMatchObject({ active: true }); expect(Object.keys(v1).sort()).toEqual(['events', 'id', 'secret', 'url']);
  });
  it('WHK-V2-02: la entrega v2 es un CloudEvent v1.0 firmado con sha256=<HMAC(secret, cuerpo)> y sin cabecera v1', async () => {
    await subscribe('client-a', ['booking.confirmed'], '2', 'firma-secreta-v2-abc');
    const eventId = randomUUID(); await publish('client-a~user-1', { eventId, eventType: 'booking.confirmed', correlationId: 'corr-42', data: { bookingId: randomUUID(), pnr: 'XK7P2Q', status: 'CONFIRMED' } });
    expect(await useCases.dispatch(ctx, {})).toBe(1);
    const [, body, headers] = poster.post.mock.calls[0] as [string, string, Record<string, string>]; const event = JSON.parse(body) as Record<string, unknown>;
    expect(headers['x-webhook-signature']).toBe(`sha256=${createHmac('sha256', 'firma-secreta-v2-abc').update(body).digest('hex')}`);
    expect(headers['content-type']).toMatch(/^application\/cloudevents\+json/); expect(headers['x-correlation-id']).toBe('corr-42'); expect(headers).not.toHaveProperty('x-flight-signature');
    expect(event).toMatchObject({ specversion: '1.0', type: 'ec.edu.epn.booking.vuelos.booking.confirmed', source: '/aerolineas/gabatair/vuelos', id: 'evt-vue-000042', time: now.toISOString(), datacontenttype: 'application/json', correlationid: 'corr-42' });
    expect(event.data).toMatchObject({ pnr: 'XK7P2Q', status: 'CONFIRMED', ownerId: 'user-1' });
  });
  it('WHK-V2-03: la entrega v1 no cambia (mismas cinco propiedades y firma t=…,v1=…)', async () => {
    await subscribe('owner-v1', ['booking.confirmed'], undefined, 'firma-secreta-v1-abc');
    await publish('owner-v1', { eventType: 'booking.confirmed', correlationId: 'corr-ignored', data: { bookingId: randomUUID(), status: 'CONFIRMED', dataJson: JSON.stringify({ grandTotal: { currency: 'USD', total: '1.00' } }) } });
    await useCases.dispatch(ctx, {});
    const [, body, headers] = poster.post.mock.calls[0] as [string, string, Record<string, string>]; const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['eventId', 'eventType', 'occurredAt', 'apiVersion', 'data']); expect(Object.keys(parsed.data as object).sort()).toEqual(['bookingId', 'status']);
    const timestamp = Math.floor(now.getTime() / 1000); expect(headers['x-flight-signature']).toBe(`t=${timestamp},v1=${createHmac('sha256', 'firma-secreta-v1-abc').update(`${timestamp}.${body}`).digest('hex')}`);
    expect(headers).not.toHaveProperty('x-webhook-signature');
  });
  it('WHK-V2-04: sin correlación el correlationid es el eventId y el id sale del seq con seis dígitos', async () => {
    await subscribe('client-a', ['hold.expired'], '2'); const { eventId } = await publish('client-a', { eventType: 'hold.expired', data: { holdId: randomUUID() } }); await useCases.dispatch(ctx, {});
    const event = JSON.parse(poster.post.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(event).toMatchObject({ correlationid: eventId, id: cloudEventId(42) }); expect(cloudEventId(7)).toBe('evt-vue-000007'); expect(cloudEventId(1234567)).toBe('evt-vue-1234567');
  });
  it('WHK-V2-05: los campos extra viajan en data y no pueden reescribir los campos base', async () => {
    await subscribe('client-a', ['booking.ticket_issued'], '2'); const bookingId = randomUUID();
    await publish('client-a~u', { eventType: 'booking.ticket_issued', data: { bookingId, pnr: 'AAAAAA', status: 'CONFIRMED', dataJson: JSON.stringify({ paymentReference: 'PAY-1', tickets: [{ ticketId: 't1' }], status: 'HACKED', bookingId: 'otro', ownerId: 'suplantado' }) } }); await useCases.dispatch(ctx, {});
    const { data } = JSON.parse(poster.post.mock.calls[0][1] as string) as { data: Record<string, unknown> };
    expect(data).toMatchObject({ paymentReference: 'PAY-1', tickets: [{ ticketId: 't1' }], status: 'CONFIRMED', bookingId, ownerId: 'u' });
  });
  it('WHK-V2-06: data.ownerId es solo el usuario final; un dueño sin cliente no se expone', async () => {
    await subscribe('plain-owner', ['booking.confirmed'], '2'); await publish('plain-owner', { eventType: 'booking.confirmed', data: { bookingId: randomUUID(), status: 'CONFIRMED' } }); await useCases.dispatch(ctx, {});
    expect((JSON.parse(poster.post.mock.calls[0][1] as string) as { data: object }).data).not.toHaveProperty('ownerId');
  });
  it('WHK-V2-07: el subject es el bookingId, el holdId o vuelo/fecha', async () => {
    await subscribe('client-a', ['booking.confirmed', 'hold.expired', 'flight.status_changed'], '2'); const bookingId = randomUUID(); const holdId = randomUUID();
    await publish('client-a', { eventType: 'booking.confirmed', data: { bookingId } }); await publish('client-a', { eventType: 'hold.expired', data: { holdId } }); await publish('client-a', { eventType: 'flight.status_changed', data: { dataJson: JSON.stringify({ flightNumber: 'GA101', date: '2026-11-02' }) } });
    await useCases.dispatch(ctx, {}); const subjects = poster.post.mock.calls.map((call) => (JSON.parse(call[1] as string) as { subject?: string }).subject);
    expect(subjects).toEqual([bookingId, holdId, 'GA101/2026-11-02']);
  });
  it('WHK-V2-08: los tres eventos nuevos son suscribibles', async () => {
    await expect(subscribe('client-a', ['hold.created', 'booking.seat_changed', 'flight.status_changed'], '2')).resolves.toMatchObject({ active: true });
  });
  it('WHK-V2-09: D1 — la suscripción del cliente recibe los eventos de <clientId>~* y la de otro cliente no', async () => {
    const mine = await subscribe('client-a', ['booking.confirmed'], '2'); await subscribe('client-b', ['booking.confirmed'], '2');
    await publish('client-a~user-1', { eventType: 'booking.confirmed', data: { bookingId: randomUUID() } });
    expect(store.deliveries.map((d) => d.subscriptionId)).toEqual([mine.id]);
  });
  it('WHK-V2-10: D1 — un dueño de v1 (sin ~) solo entrega a su propia suscripción', async () => {
    await subscribe('client-a', ['booking.confirmed'], '2'); const own = await subscribe('uuid-supabase-1', ['booking.confirmed']);
    await publish('uuid-supabase-1', { eventType: 'booking.confirmed', data: { bookingId: randomUUID() } });
    expect(store.deliveries.map((d) => d.subscriptionId)).toEqual([own.id]);
  });
  it('WHK-V2-11: subscriberOwners separa en el primer ~', () => {
    expect(subscriberOwners('plain')).toEqual(['plain']); expect(subscriberOwners('c~u')).toEqual(['c~u', 'c']); expect(subscriberOwners('c~u~v')).toEqual(['c~u~v', 'c']);
  });
  it('WHK-V2-12: todo evento se registra aunque no haya suscripciones y un reintento con el mismo eventId conserva el seq', async () => {
    const eventId = randomUUID(); await publish('client-a~u', { eventId, eventType: 'booking.confirmed', data: { bookingId: randomUUID() } }); await publish('client-a~u', { eventId, eventType: 'booking.confirmed', data: { bookingId: randomUUID() } });
    expect(store.events).toHaveLength(1); expect(store.deliveries).toHaveLength(0);
  });
  it('WHK-V2-13: dataJson inválido (no JSON, arreglo o demasiado largo) se rechaza', async () => {
    for (const dataJson of ['{no-json', '[1,2]', '"texto"', 'null', JSON.stringify({ a: 'x'.repeat(9000) })]) await expect(publish('client-a', { eventType: 'booking.confirmed', data: { dataJson } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('WHK-V2-14: ListEvents filtra por cliente y tipo, pagina con afterSeq y devuelve dataJson', async () => {
    await publish('client-a~u', { eventType: 'booking.confirmed', data: { bookingId: randomUUID(), dataJson: JSON.stringify({ grandTotal: { currency: 'USD', total: '10.00' } }) } }); await publish('client-a', { eventType: 'hold.expired', data: { holdId: randomUUID() } }); await publish('client-b~u', { eventType: 'booking.confirmed', data: { bookingId: randomUUID() } });
    const all = await useCases.listEvents(ctx, { ownerPrefix: 'client-a' }); expect(all.total).toBe(2); expect(all.items.map((e) => e.eventType)).toEqual(['booking.confirmed', 'hold.expired']); expect(JSON.parse(all.items[0].dataJson)).toMatchObject({ grandTotal: { total: '10.00' } });
    expect((await useCases.listEvents(ctx, { ownerPrefix: 'client-a', afterSeq: all.items[0].seq })).items.map((e) => e.eventType)).toEqual(['hold.expired']);
    expect((await useCases.listEvents(ctx, { ownerPrefix: 'client-a', eventType: 'hold.expired' })).items).toHaveLength(1);
    expect((await useCases.listEvents(ctx, { ownerPrefix: 'client-a', limit: 1 })).items).toHaveLength(1);
  });
  it('WHK-V2-15: ListEvents valida limit, tipo y campos desconocidos', async () => {
    for (const bad of [{ ownerPrefix: 'a', limit: 0 }, { ownerPrefix: 'a', limit: 201 }, { ownerPrefix: 'a', eventType: 'otro.evento' }, { ownerPrefix: 'a', extra: 1 }, { ownerPrefix: '' }]) await expect(useCases.listEvents(ctx, bad)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('WHK-V2-16: v1Body conserva el orden y omite los campos de v2', () => {
    const payload: WebhookPayload = { eventId: 'e', eventType: 'booking.confirmed', occurredAt: 't', apiVersion: '1.5.0.0', data: { bookingId: 'b' }, correlationId: 'c', seq: 1, ownerId: 'o', extra: { x: 1 } };
    expect(JSON.stringify(v1Body(payload))).toBe('{"eventId":"e","eventType":"booking.confirmed","occurredAt":"t","apiVersion":"1.5.0.0","data":{"bookingId":"b"}}');
  });
});

describe('F12a Webhooks: política de URL y perfil de integración local', () => {
  it('WHK-V2-17: 100.64.0.0/10 se rechaza en producción y fuera del perfil local', async () => {
    for (const ip of ['100.64.0.1', '100.100.50.7', '100.127.255.254']) { await expect(new WebhookUrlPolicy(true).assertSafe(`https://${ip}/hook`)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); await expect(new WebhookUrlPolicy(false).assertSafe(`http://${ip}/hook`)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); }
  });
  it('WHK-V2-18: en el perfil local se admite http y 100.64.0.0/10', async () => {
    const policy = new WebhookUrlPolicy(false, true); await expect(policy.assertSafe('http://100.101.102.103:4000/hook')).resolves.toBeUndefined();
  });
  it('WHK-V2-19: el perfil local no abre el resto de rangos privados ni las credenciales en la URL', async () => {
    const policy = new WebhookUrlPolicy(false, true);
    for (const url of ['http://10.0.0.5/hook', 'http://192.168.1.4/hook', 'http://127.0.0.1/hook', 'http://169.254.169.254/latest', 'http://user:pass@100.101.102.103/hook']) await expect(policy.assertSafe(url)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('WHK-V2-20: las direcciones públicas vecinas de 100.64.0.0/10 siguen permitidas con https', async () => {
    await expect(new WebhookUrlPolicy(true).assertSafe('https://100.63.255.255/hook')).resolves.toBeUndefined(); await expect(new WebhookUrlPolicy(true).assertSafe('https://100.128.0.1/hook')).resolves.toBeUndefined();
  });
  it('WHK-V2-21: producción exige https aunque la IP sea Tailscale y el perfil local', async () => {
    await expect(new WebhookUrlPolicy(true, true).assertSafe('http://100.101.102.103/hook')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('WHK-V2-22: el servidor se niega a arrancar con INTEGRATION_LOCAL y producción', async () => {
    await expect(createWebhooksServer({ url: '127.0.0.1:0', internalApiKey: 'k'.repeat(32), encryptionKey: key, prisma: {} as never, production: true, integrationLocal: true })).rejects.toThrow('INTEGRATION_LOCAL is forbidden in production');
  });
});
