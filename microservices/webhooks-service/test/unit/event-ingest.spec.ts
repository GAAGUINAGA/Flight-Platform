import { randomUUID } from 'node:crypto'; import { Buffer } from 'node:buffer';
import { BusBatch, BusMessage, EventBusConsumer, EventLog, HttpPoster, UrlPolicy, WebhookStore } from '../../src/application/ports';
import { WebhookUseCases } from '../../src/application/webhook-use-cases';
import { retryDecision } from '../../src/domain/event-retry';
import { Delivery, StoredEvent, Subscription, WebhookPayload } from '../../src/domain/webhook';
import { AesGcmCipher } from '../../src/infrastructure/security/webhook-security';

/* global beforeEach */
const now = new Date('2026-11-08T12:00:00.000Z'); const ctx = { ownerId: 'gateway-scheduler', role: 'system', correlationId: 'test' };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
class Store implements WebhookStore, EventLog {
  subscriptions: Subscription[] = []; deliveries: Delivery[] = []; events: Array<{ seq: number; eventId: string; ownerId: string; eventType: string; data: Record<string, unknown> }> = []; failActiveFor = false;
  async createSubscription(input: Subscription) { this.subscriptions.push(input); return input; } async listSubscriptions() { return this.subscriptions; } async deleteSubscription() { return true; }
  async activeFor(ownerId: string, eventType: string) { if (this.failActiveFor) throw new Error('db down'); return this.subscriptions.filter((s) => s.ownerId === ownerId && s.active && s.events.includes(eventType as never)); }
  async getSubscription(id: string) { return this.subscriptions.find((s) => s.id === id) ?? null; }
  // Igual que la BD: único (eventId, subscriptionId).
  async createDeliveries(eventId: string, payload: WebhookPayload, ids: string[], at: Date) { for (const subscriptionId of ids) if (!this.deliveries.some((d) => d.eventId === eventId && d.subscriptionId === subscriptionId)) this.deliveries.push({ id: randomUUID(), eventId, subscriptionId, payload, status: 'PENDING', attempts: 0, nextAttemptAt: at }); }
  async claimPending(at: Date) { return this.deliveries.filter((d) => d.status === 'PENDING' && d.nextAttemptAt <= at).map((d) => ({ ...d })); }
  async delivered(id: string) { this.deliveries.find((d) => d.id === id)!.status = 'DELIVERED'; } async failed() { return undefined; }
  async recordEvent(input: { eventId: string; ownerId: string; eventType: string; data: Record<string, unknown> }) { const found = this.events.find((e) => e.eventId === input.eventId); if (found) return found.seq; this.events.push({ seq: this.events.length + 1, ...input }); return this.events.length; }
  async listEvents(): Promise<{ items: StoredEvent[]; total: number }> { return { items: [], total: 0 }; }
}
interface Moved { queue: string; attempt: number; reason?: string }
class FakeMessage implements BusMessage {
  acked = 0; requeued = 0; moved: Moved[] = []; failMove = false;
  constructor(public body: string, public attempt = 0) {}
  async ack() { this.acked += 1; } async requeue() { this.requeued += 1; }
  async moveTo(queue: string, attempt: number, reason?: string) { if (this.failMove) throw new Error('broker down'); this.moved.push({ queue, attempt, reason }); }
}
class FakeBus implements EventBusConsumer {
  opened = 0; closed = 0; down = false;
  constructor(public messages: FakeMessage[] = []) {}
  async open(): Promise<BusBatch> { if (this.down) throw new Error('unavailable'); this.opened += 1; return { next: async () => this.messages.shift(), close: async () => { this.closed += 1; } }; }
}
const cloudEvent = (n: number, over: Record<string, unknown> = {}, ownerId = 'owner-a') => JSON.stringify({ specversion: '1.0', id: ID(n), type: 'ec.edu.epn.booking.vuelos.booking.confirmed', source: '/gabatair/esb', time: now.toISOString(), datacontenttype: 'application/json', correlationid: ID(n), data: { ownerId, payload: { eventId: ID(n), eventType: 'booking.confirmed', occurredAt: now.toISOString(), apiVersion: 'v1', correlationId: 'corr', data: { bookingId: 'b', pnr: 'ABC123', status: 'CONFIRMED' }, ...over } } });
const policy: UrlPolicy = { assertSafe: jest.fn().mockResolvedValue(undefined) }; const cipher = new AesGcmCipher(Buffer.alloc(32, 7).toString('base64'));
const settings = { queue: 'q.webhooks.entrega', maxAttempts: 3, pullBatch: 2, pullMaxBatches: 3, pullBudgetMs: 60_000 };

describe('BUS-W: webhooks retira eventos del bus', () => {
  let store: Store; let poster: HttpPoster; let bus: FakeBus; let useCases: WebhookUseCases; let logs: Array<{ entry: object; message: string }>;
  beforeEach(async () => {
    store = new Store(); poster = { post: jest.fn().mockResolvedValue(204) }; bus = new FakeBus(); logs = [];
    useCases = new WebhookUseCases(store, policy, cipher, poster, { timeoutMs: 5000, backoffMinutes: [1], production: false, events: { ...settings, log: (entry, message) => logs.push({ entry, message }) } }, () => now, store, bus);
    await useCases.create(ctx, { ownerId: 'owner-a', url: 'https://hooks.example.test/1', events: ['booking.confirmed'], secret: 'secret' });
  });

  it('ingresa el evento con el mismo caso de uso (feed y entregas) y confirma el mensaje', async () => {
    const message = new FakeMessage(cloudEvent(1)); bus.messages = [message];
    expect(await useCases.ingest(ctx)).toEqual({ ingested: 1, retried: 0, failed: 0 });
    expect(message.acked).toBe(1); expect(message.moved).toEqual([]);
    expect(store.events).toHaveLength(1); expect(store.events[0]).toMatchObject({ eventId: ID(1), ownerId: 'owner-a', eventType: 'booking.confirmed' });
    expect(store.deliveries).toHaveLength(1); expect(store.deliveries[0].payload).toMatchObject({ eventId: ID(1), apiVersion: 'v1', correlationId: 'corr', ownerId: 'owner-a' });
    expect(bus.closed).toBe(1);
  });

  it('BUS-I3 (unitaria): el mismo mensaje dos veces deja un evento y una entrega por suscripción', async () => {
    const first = new FakeMessage(cloudEvent(1)); const second = new FakeMessage(cloudEvent(1)); bus.messages = [first, second];
    expect(await useCases.ingest(ctx)).toMatchObject({ ingested: 2 });
    expect(first.acked + second.acked).toBe(2);
    expect(store.events).toHaveLength(1); expect(store.deliveries).toHaveLength(1);
  });

  it('respeta el límite de lote por corrida (pullBatch × pullMaxBatches)', async () => {
    bus.messages = Array.from({ length: 10 }, (_, i) => new FakeMessage(cloudEvent(i + 1)));
    expect(await useCases.ingest(ctx)).toMatchObject({ ingested: 6 });
    expect(bus.messages).toHaveLength(4);
  });

  it('dispatch retira primero, entrega después y conserva su resultado (entregas)', async () => {
    bus.messages = [new FakeMessage(cloudEvent(1)), new FakeMessage(cloudEvent(2))];
    await expect(useCases.dispatch(ctx, {})).resolves.toBe(2);
    expect(poster.post).toHaveBeenCalledTimes(2);
    expect(store.deliveries.every((d) => d.status === 'DELIVERED')).toBe(true);
  });

  it('BUS-I4 (unitaria): un fallo transitorio pasa por esperas 1, 2 y 3 y termina en fallidos al agotar los intentos', async () => {
    store.failActiveFor = true; const destinations: string[] = [];
    let attempt = 0;
    for (let round = 0; round < 4; round += 1) {
      const message = new FakeMessage(cloudEvent(1), attempt); bus.messages = [message];
      await useCases.ingest(ctx);
      expect(message.acked).toBe(0);
      destinations.push(message.moved[0].queue); attempt = message.moved[0].attempt;
    }
    expect(destinations).toEqual(['q.webhooks.entrega.espera.1', 'q.webhooks.entrega.espera.2', 'q.webhooks.entrega.espera.3', 'q.webhooks.entrega.fallidos']);
    // El evento ya quedó en el feed (idempotente por eventId); lo que falló fue crear las entregas, que se reintenta completo.
    expect(store.deliveries).toHaveLength(0);
  });

  it('BUS-I5 (unitaria): evento fuera de la lista o sobre inválido van directo a fallidos, sin reintento', async () => {
    const outside = new FakeMessage(cloudEvent(1, { eventType: 'otro.evento' })); const garbage = new FakeMessage('no es json'); const wrongVersion = new FakeMessage(JSON.stringify({ specversion: '0.3', data: {} }));
    const extra = new FakeMessage(cloudEvent(2, { data: { bookingId: 'b', intruso: 'x' } }));
    bus.messages = [outside, garbage, wrongVersion, extra];
    expect(await useCases.ingest(ctx)).toMatchObject({ ingested: 0, failed: 4 });
    expect(outside.moved).toEqual([{ queue: 'q.webhooks.entrega.fallidos', attempt: 0, reason: 'VALIDATION_FAILED' }]);
    expect(garbage.moved[0]).toMatchObject({ queue: 'q.webhooks.entrega.fallidos', reason: 'INVALID_ENVELOPE' });
    expect(wrongVersion.moved[0]).toMatchObject({ queue: 'q.webhooks.entrega.fallidos', reason: 'INVALID_ENVELOPE' });
    expect(extra.moved[0]).toMatchObject({ queue: 'q.webhooks.entrega.fallidos', reason: 'VALIDATION_FAILED' });
    expect(store.events).toHaveLength(0);
  });

  it('si ni siquiera se puede mover el mensaje, se devuelve a la cola y no se pierde', async () => {
    store.failActiveFor = true; const message = new FakeMessage(cloudEvent(1)); message.failMove = true; bus.messages = [message];
    expect(await useCases.ingest(ctx)).toMatchObject({ ingested: 0, retried: 1 });
    expect(message.requeued).toBe(1); expect(message.acked).toBe(0);
  });

  it('broker caído: no lanza, registra la dependencia sin datos y dispatch entrega lo que ya estaba pendiente', async () => {
    await useCases.publish(ctx, { ownerId: 'owner-a', payload: { eventId: ID(5), eventType: 'booking.confirmed' } });
    bus.down = true;
    await expect(useCases.dispatch(ctx, {})).resolves.toBe(1);
    expect(logs).toEqual([{ entry: { dependency: 'event-bus', code: 'BUS_UNAVAILABLE' }, message: 'event ingestion skipped' }]);
  });

  it('sin bus configurado (modo de vuelta atrás) dispatch se comporta como antes', async () => {
    const plain = new WebhookUseCases(store, policy, cipher, poster, { timeoutMs: 5000, backoffMinutes: [1], production: false }, () => now, store);
    await plain.publish(ctx, { ownerId: 'owner-a', payload: { eventId: ID(7), eventType: 'booking.confirmed' } });
    expect(await plain.ingest(ctx)).toEqual({ ingested: 0, retried: 0, failed: 0 });
    await expect(plain.dispatch(ctx, {})).resolves.toBe(1);
  });

  it('dispatch sigue exigiendo el rol system antes de tocar el bus', async () => {
    bus.messages = [new FakeMessage(cloudEvent(1))];
    await expect(useCases.dispatch({ ...ctx, role: 'customer' }, {})).rejects.toThrow();
    expect(bus.opened).toBe(0);
  });

  it('el registro no contiene datos del evento', async () => {
    store.failActiveFor = true; bus.messages = [new FakeMessage(cloudEvent(1))]; await useCases.ingest(ctx);
    expect(JSON.stringify(logs)).not.toMatch(/ABC123|owner-a|corr/);
  });
});

describe('BUS-W: política de reintento (misma que la del ESB)', () => {
  it('decide la siguiente espera, fallidos al agotar intentos y fallidos si no es reintentable', () => {
    expect(retryDecision('q.webhooks.entrega', 0, 3, true)).toEqual({ action: 'retry', queue: 'q.webhooks.entrega.espera.1', attempt: 1 });
    expect(retryDecision('q.webhooks.entrega', 3, 3, true)).toEqual({ action: 'fail', queue: 'q.webhooks.entrega.fallidos' });
    expect(retryDecision('q.webhooks.entrega', 0, 3, false)).toEqual({ action: 'fail', queue: 'q.webhooks.entrega.fallidos' });
  });
});
