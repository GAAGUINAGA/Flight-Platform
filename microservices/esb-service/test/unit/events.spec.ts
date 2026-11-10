import { describe, expect, it } from '@jest/globals';
import { DEFAULT_EVENT_LIMITS, OutboxEventOperations, type EventLimits } from '../../src/application/event-operations';
import type { BusSession, EventBus, EventOutbox, NewOutboxEvent, OutboxRow, PublishReport, ReleasedRow } from '../../src/application/event-ports';
import { ExecuteOperation } from '../../src/application/execute-operation';
import { buildEnvelope, BusUnavailableError, publishBackoffMs, retryDecision, topologyFor, WEBHOOKS_BINDINGS, WEBHOOKS_QUEUE } from '../../src/domain/events';
import { FakeInvoker, FakeProbe, MemoryLogger } from './fakes';

class MemoryOutbox implements EventOutbox {
  rows: Array<NewOutboxEvent & { seq: number; status: 'PENDING' | 'PUBLISHED'; attempts: number; availableAt: Date; lockedUntil?: Date; lastError?: string; publishedAt?: Date }> = [];
  private next = 1;
  async insert(event: NewOutboxEvent, now: Date): Promise<boolean> {
    if (this.rows.some((row) => row.eventId === event.eventId)) return false;
    this.rows.push({ ...event, seq: this.next++, status: 'PENDING', attempts: 0, availableAt: now }); return true;
  }
  async claim(now: Date, limit: number, leaseMs: number): Promise<OutboxRow[]> {
    const rows = this.rows.filter((row) => row.status === 'PENDING' && row.availableAt <= now && (!row.lockedUntil || row.lockedUntil < now)).slice(0, limit);
    for (const row of rows) { row.attempts += 1; row.lockedUntil = new Date(now.getTime() + leaseMs); }
    return rows.map((row) => ({ seq: row.seq, eventId: row.eventId, routingKey: row.routingKey, envelope: row.envelope, attempts: row.attempts }));
  }
  async markPublished(seqs: number[], now: Date): Promise<void> { for (const row of this.rows) if (seqs.includes(row.seq)) { row.status = 'PUBLISHED'; row.publishedAt = now; row.lockedUntil = undefined; } }
  async release(items: ReleasedRow[]): Promise<void> { for (const item of items) { const row = this.rows.find((r) => r.seq === item.seq); if (row) { row.lockedUntil = undefined; row.availableAt = item.availableAt; row.lastError = item.errorCode; } } }
  async purgePublished(before: Date): Promise<number> { const keep = this.rows.filter((row) => !(row.status === 'PUBLISHED' && row.publishedAt! < before)); const removed = this.rows.length - keep.length; this.rows = keep; return removed; }
  async pendingCount(): Promise<number> { return this.rows.filter((row) => row.status === 'PENDING').length; }
}

class FakeBus implements EventBus {
  opened = 0; closed = 0; published: OutboxRow[][] = []; down = false; unroutable = new Set<number>(); failOnPublish = false;
  async open(): Promise<BusSession> {
    if (this.down) throw new BusUnavailableError();
    this.opened += 1;
    return {
      publish: async (rows): Promise<PublishReport> => {
        if (this.failOnPublish) throw new Error('connection lost');
        this.published.push(rows);
        return { published: rows.filter((row) => !this.unroutable.has(row.seq)).map((row) => row.seq), failed: rows.filter((row) => this.unroutable.has(row.seq)).map((row) => ({ seq: row.seq, code: 'UNROUTABLE' })) };
      },
      close: async () => { this.closed += 1; }
    };
  }
  async ping(): Promise<boolean> { return !this.down; }
}

const NOW = new Date('2026-11-08T12:00:00.000Z');
const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (n: number, extra: Record<string, unknown> = {}) => ({ ownerId: 'owner-1', payload: { eventId: ID(n), eventType: 'booking.confirmed', occurredAt: '2026-11-08T11:00:00.000Z', apiVersion: 'v1', data: { bookingId: 'b', pnr: 'ABC123', status: 'CONFIRMED' }, ...extra } });
const build = (limits: Partial<EventLimits> = {}, clock = { now: NOW }) => {
  const outbox = new MemoryOutbox(); const bus = new FakeBus();
  const ops = new OutboxEventOperations(outbox, bus, { ...DEFAULT_EVENT_LIMITS, ...limits }, () => clock.now, () => ID(999));
  return { outbox, bus, ops, clock };
};
const farFuture = new Date('2026-11-08T12:00:30.000Z');

describe('BUS-U: dominio del bus de eventos', () => {
  it('BUS-U1: el sobre CloudEvents lleva id, type, correlationid y el PublishEvent intacto en data', () => {
    const payload = { eventId: ID(1), eventType: 'hold.expired', occurredAt: '2026-11-08T11:00:00.000Z', apiVersion: '1.5.0.0', correlationId: 'corr-1', data: { holdId: 'h' } };
    expect(buildEnvelope('owner-1', payload)).toEqual({ specversion: '1.0', id: ID(1), type: 'ec.edu.epn.booking.vuelos.hold.expired', source: '/gabatair/esb', time: payload.occurredAt, datacontenttype: 'application/json', correlationid: 'corr-1', data: { ownerId: 'owner-1', payload } });
    expect(buildEnvelope('o', { ...payload, correlationId: undefined }).correlationid).toBe(ID(1));
  });

  it('BUS-U1: la topología tiene exchange topic, cola principal enlazada, una espera por intento con TTL y cola de fallidos', () => {
    const topology = topologyFor(WEBHOOKS_QUEUE, WEBHOOKS_BINDINGS, [30_000, 120_000, 600_000]);
    expect(topology.exchange).toBe('flight.events');
    expect(topology.queues.map((queue) => queue.name)).toEqual(['q.webhooks.entrega', 'q.webhooks.entrega.espera.1', 'q.webhooks.entrega.espera.2', 'q.webhooks.entrega.espera.3', 'q.webhooks.entrega.fallidos']);
    expect(topology.queues[0].bindings).toEqual(['booking.#', 'hold.#', 'flight.#']);
    expect(topology.queues[2].args).toEqual({ 'x-message-ttl': 120_000, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'q.webhooks.entrega' });
  });

  it('BUS-U3: la espera de publicación crece 5 s, 10 s, 20 s… con tope de 5 min', () => {
    expect([1, 2, 3, 4, 7, 20].map(publishBackoffMs)).toEqual([5_000, 10_000, 20_000, 40_000, 300_000, 300_000]);
  });

  it('BUS-U6: la decisión del consumidor va a la siguiente espera, a fallidos al agotar intentos o ante un error no reintentable', () => {
    expect(retryDecision(WEBHOOKS_QUEUE, 0, 3, true)).toEqual({ action: 'retry', queue: 'q.webhooks.entrega.espera.1', attempt: 1 });
    expect(retryDecision(WEBHOOKS_QUEUE, 2, 3, true)).toEqual({ action: 'retry', queue: 'q.webhooks.entrega.espera.3', attempt: 3 });
    expect(retryDecision(WEBHOOKS_QUEUE, 3, 3, true)).toEqual({ action: 'fail', queue: 'q.webhooks.entrega.fallidos' });
    expect(retryDecision(WEBHOOKS_QUEUE, 0, 3, false)).toEqual({ action: 'fail', queue: 'q.webhooks.entrega.fallidos' });
  });
});

describe('BUS-U2: ingreso de eventos a la outbox', () => {
  it('guarda el evento con su clave de enrutamiento y responde el eventId sin tocar al broker', async () => {
    const { ops, outbox, bus } = build();
    expect(await ops.ingest(event(1))).toEqual({ eventId: ID(1) });
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({ routingKey: 'booking.confirmed', ownerId: 'owner-1', status: 'PENDING', envelope: { id: ID(1), correlationid: ID(1) } });
    expect(bus.opened).toBe(0);
  });

  it('asigna eventId y occurredAt cuando faltan, y quedan fijos en el sobre', async () => {
    const { ops, outbox } = build();
    const input = event(1); delete (input.payload as Record<string, unknown>).eventId; delete (input.payload as Record<string, unknown>).occurredAt;
    expect(await ops.ingest(input)).toEqual({ eventId: ID(999) });
    expect(outbox.rows[0].envelope.data.payload).toMatchObject({ eventId: ID(999), occurredAt: NOW.toISOString() });
  });

  it('es idempotente por eventId: el mismo evento dos veces deja una sola fila', async () => {
    const { ops, outbox } = build();
    await ops.ingest(event(1)); await ops.ingest(event(1));
    expect(outbox.rows).toHaveLength(1);
  });

  it.each([
    ['eventType con forma inválida', event(1, { eventType: 'Booking Confirmed' })],
    ['eventId que no es GUID', event(1, { eventId: 'no-es-guid' })],
    ['propiedad extra en payload', event(1, { extra: true })],
    ['data que no es objeto', event(1, { data: 'texto' })],
    ['sin dueño', { payload: event(1).payload }],
    ['dueño vacío', { ownerId: '', payload: event(1).payload }],
    ['propiedad extra en el sobre', { ...event(1), otro: 1 }],
    ['sobre mayor que el límite', event(1, { data: { blob: 'x'.repeat(70_000) } })]
  ])('rechaza %s con VALIDATION_FAILED y no escribe nada', async (_name, input) => {
    const { ops, outbox } = build();
    await expect(ops.ingest(input as Record<string, unknown>)).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    expect(outbox.rows).toHaveLength(0);
  });
});

describe('BUS-U4: publicación de la outbox por lotes', () => {
  it('sin filas pendientes no abre conexión al broker', async () => {
    const { ops, bus } = build();
    expect(await ops.publishOutbox(farFuture)).toEqual({ claimed: 0, published: 0, pending: 0, brokerAvailable: true });
    expect(bus.opened).toBe(0);
  });

  it('publica en orden de seq, en lotes, con una sola conexión, y marca PUBLISHED', async () => {
    const { ops, outbox, bus } = build({ publishBatch: 100, publishMaxBatches: 5 });
    for (let n = 1; n <= 250; n += 1) await ops.ingest(event(n));
    expect(await ops.publishOutbox(farFuture)).toEqual({ claimed: 250, published: 250, pending: 0, brokerAvailable: true });
    expect(bus.published.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(bus.published.flat().map((row) => row.seq)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(bus.opened).toBe(1); expect(bus.closed).toBe(1);
    expect(outbox.rows.every((row) => row.status === 'PUBLISHED')).toBe(true);
  });

  it('se detiene en el máximo de lotes por corrida y deja el resto pendiente para el siguiente tick', async () => {
    const { ops } = build({ publishBatch: 10, publishMaxBatches: 2 });
    for (let n = 1; n <= 35; n += 1) await ops.ingest(event(n));
    expect(await ops.publishOutbox(farFuture)).toMatchObject({ claimed: 20, published: 20, pending: 15 });
  });

  it('dos corridas seguidas no republican lo ya publicado', async () => {
    const { ops, bus } = build();
    await ops.ingest(event(1));
    await ops.publishOutbox(farFuture); await ops.publishOutbox(farFuture);
    expect(bus.published.flat()).toHaveLength(1);
  });

  it('respeta el arriendo: una fila reclamada y no liberada no se reclama hasta que vence', async () => {
    const { ops, outbox, clock } = build({ leaseMs: 60_000 });
    await ops.ingest(event(1));
    await outbox.claim(clock.now, 10, 60_000); // otra instancia la tiene reclamada
    expect(await ops.publishOutbox(farFuture)).toMatchObject({ claimed: 0, published: 0, pending: 1 });
    clock.now = new Date(NOW.getTime() + 61_000);
    expect(await ops.publishOutbox(new Date(clock.now.getTime() + 30_000))).toMatchObject({ claimed: 1, published: 1, pending: 0 });
  });

  it('una fila sin cola de destino se libera con espera y las demás se publican', async () => {
    const { ops, outbox, bus } = build();
    await ops.ingest(event(1)); await ops.ingest(event(2)); bus.unroutable.add(2);
    expect(await ops.publishOutbox(farFuture)).toMatchObject({ claimed: 2, published: 1, pending: 1, brokerAvailable: true });
    expect(outbox.rows[1]).toMatchObject({ status: 'PENDING', lastError: 'UNROUTABLE', lockedUntil: undefined });
    expect(outbox.rows[1].availableAt.getTime()).toBe(NOW.getTime() + 5_000);
  });

  it('limpia lo publicado más viejo que la retención', async () => {
    const { ops, outbox, clock } = build({ retentionDays: 7 });
    await ops.ingest(event(1)); await ops.publishOutbox(farFuture);
    clock.now = new Date(NOW.getTime() + 8 * 86_400_000);
    await ops.publishOutbox(new Date(clock.now.getTime() + 30_000));
    expect(outbox.rows).toHaveLength(0);
  });
});

describe('BUS-U5: broker caído', () => {
  it('no es un error: las filas se liberan con espera creciente y siguen pendientes; el ingreso sigue funcionando', async () => {
    const { ops, outbox, bus, clock } = build();
    bus.down = true;
    await ops.ingest(event(1));
    expect(await ops.publishOutbox(farFuture)).toEqual({ claimed: 1, published: 0, pending: 1, brokerAvailable: false });
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', lastError: 'BROKER_UNAVAILABLE', attempts: 1 });
    expect(outbox.rows[0].availableAt.getTime()).toBe(NOW.getTime() + 5_000);
    // durante la espera no se vuelve a reclamar; el ingreso no se ve afectado
    await ops.ingest(event(2));
    expect(await ops.publishOutbox(farFuture)).toMatchObject({ claimed: 1, brokerAvailable: false });
    // al volver el broker se publican todas, en orden
    bus.down = false; clock.now = new Date(NOW.getTime() + 60_000);
    expect(await ops.publishOutbox(new Date(clock.now.getTime() + 30_000))).toMatchObject({ claimed: 2, published: 2, pending: 0, brokerAvailable: true });
    expect(bus.published.flat().map((row) => row.seq)).toEqual([1, 2]);
  });

  it('un fallo de confirmación que no es de enrutamiento se informa como broker no disponible', async () => {
    const { ops, outbox, bus } = build();
    await ops.ingest(event(1));
    const open = bus.open.bind(bus);
    bus.open = async () => { const session = await open(); return { ...session, publish: async (rows: OutboxRow[]) => ({ published: [], failed: rows.map((row) => ({ seq: row.seq, code: 'CONFIRM_NACK' })) }) }; };
    expect(await ops.publishOutbox(farFuture)).toMatchObject({ published: 0, pending: 1, brokerAvailable: false });
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', lastError: 'CONFIRM_NACK' });
  });

  it('una conexión que se cae a media publicación deja las filas pendientes (no se pierden)', async () => {
    const { ops, outbox, bus } = build();
    await ops.ingest(event(1)); bus.failOnPublish = true;
    expect(await ops.publishOutbox(farFuture)).toMatchObject({ published: 0, pending: 1, brokerAvailable: false });
    expect(outbox.rows[0].status).toBe('PENDING');
    expect(bus.closed).toBe(1);
  });
});

describe('BUS-U6: operaciones del ESB sobre el bus', () => {
  const policy = { defaultMs: 5_000, orchestratedMs: 30_000, maxMs: 30_000 };
  const setup = (mode: 'outbox' | 'grpc') => {
    const invoker = new FakeInvoker(() => ({ eventId: 'desde-webhooks' })); const { ops, outbox } = build();
    const execute = new ExecuteOperation(invoker, new FakeProbe(), new MemoryLogger(), policy, Date.now, { operations: ops, mode });
    return { invoker, outbox, execute };
  };
  const ctx = (role?: string) => ({ correlationId: 'c-1', ownerId: 'gateway-scheduler', role });

  it('modo outbox: clientes.publicar-evento escribe en la outbox y no llama a Webhooks', async () => {
    const { invoker, outbox, execute } = setup('outbox');
    expect(await execute.execute({ operation: 'clientes.publicar-evento', input: event(1), context: ctx('system') })).toEqual({ ok: true, result: { eventId: ID(1) } });
    expect(outbox.rows).toHaveLength(1); expect(invoker.calls).toHaveLength(0);
  });

  it('modo grpc: clientes.publicar-evento sigue yendo a Webhooks y la outbox no se toca', async () => {
    const { invoker, outbox, execute } = setup('grpc');
    expect(await execute.execute({ operation: 'clientes.publicar-evento', input: event(1), context: ctx('system') })).toEqual({ ok: true, result: { eventId: 'desde-webhooks' } });
    expect(invoker.calls).toHaveLength(1); expect(invoker.calls[0]).toMatchObject({ service: 'webhooks', method: 'publishEvent' }); expect(outbox.rows).toHaveLength(0);
  });

  it('BUS-SEC: sin rol system, ambas operaciones nativas responden PERMISSION_DENIED y no escriben', async () => {
    const { outbox, execute } = setup('outbox');
    for (const role of [undefined, 'customer', 'admin', 'partner']) {
      for (const operation of ['clientes.publicar-evento', 'sistema.publicar-eventos']) {
        expect(await execute.execute({ operation, input: event(1), context: ctx(role) })).toMatchObject({ ok: false, error: { source: 'service', grpcCode: 7, catalogCode: 'PERMISSION_DENIED' } });
      }
    }
    expect(outbox.rows).toHaveLength(0);
  });

  it('un evento inválido llega como VALIDATION_FAILED del servicio (422 como antes)', async () => {
    const { execute } = setup('outbox');
    expect(await execute.execute({ operation: 'clientes.publicar-evento', input: { ownerId: 'o' }, context: ctx('system') })).toMatchObject({ ok: false, error: { source: 'service', grpcCode: 3, catalogCode: 'VALIDATION_FAILED' } });
  });

  it('sistema.publicar-eventos devuelve el informe de la corrida; con broker caído sigue siendo ok', async () => {
    const { outbox, execute } = setup('outbox');
    await execute.execute({ operation: 'clientes.publicar-evento', input: event(1), context: ctx('system') });
    expect(await execute.execute({ operation: 'sistema.publicar-eventos', input: {}, context: ctx('system') })).toEqual({ ok: true, result: { claimed: 1, published: 1, pending: 0, brokerAvailable: true } });
    expect(outbox.rows[0].status).toBe('PUBLISHED');
  });

  it('sin bus configurado, sistema.publicar-eventos es UNIMPLEMENTED', async () => {
    const execute = new ExecuteOperation(new FakeInvoker(), new FakeProbe(), new MemoryLogger(), policy);
    expect(await execute.execute({ operation: 'sistema.publicar-eventos', input: {}, context: ctx('system') })).toMatchObject({ ok: false, error: { grpcCode: 12 } });
  });
});
