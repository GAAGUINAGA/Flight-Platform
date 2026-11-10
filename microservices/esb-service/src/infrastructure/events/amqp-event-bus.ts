import { Buffer } from 'node:buffer';
import { clearTimeout, setTimeout } from 'node:timers';
import amqp from 'amqplib';
import type { BusSession, EventBus, OutboxRow, PublishReport } from '../../application/event-ports';
import { BusUnavailableError, type Topology } from '../../domain/events';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;
const CONFIRM_TIMEOUT_MS = 10_000;

const withTimeout = <T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { onTimeout(); reject(new BusUnavailableError()); }, ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
});

/** Declara exchange, colas y enlaces (idempotente). El ESB es el único que declara la topología (ADR-F12b-05). */
export async function assertTopology(channel: { assertExchange(name: string, type: string, options: object): Promise<unknown>; assertQueue(name: string, options: object): Promise<unknown>; bindQueue(queue: string, exchange: string, key: string): Promise<unknown> }, topology: Topology): Promise<void> {
  await channel.assertExchange(topology.exchange, 'topic', { durable: true });
  for (const queue of topology.queues) {
    await channel.assertQueue(queue.name, { durable: queue.durable, ...(queue.args ? { arguments: queue.args } : {}) });
    for (const key of queue.bindings ?? []) await channel.bindQueue(queue.name, topology.exchange, key);
  }
}

class AmqpSession implements BusSession {
  constructor(private readonly connection: Connection, private readonly channel: ConfirmChannel, private readonly exchange: string, private readonly returned: Set<string>) {}

  /** Publica cada fila como mensaje persistente con confirmación del broker. Un mensaje sin cola de destino (`mandatory`) se informa `UNROUTABLE`. */
  async publish(rows: OutboxRow[]): Promise<PublishReport> {
    const report: PublishReport = { published: [], failed: [] };
    const settled = rows.map((row) => new Promise<void>((resolve) => {
      const finish = (code?: string): void => { if (code) report.failed.push({ seq: row.seq, code }); else if (this.returned.has(row.eventId)) report.failed.push({ seq: row.seq, code: 'UNROUTABLE' }); else report.published.push(row.seq); resolve(); };
      try {
        this.channel.publish(this.exchange, row.routingKey, Buffer.from(JSON.stringify(row.envelope), 'utf8'), {
          persistent: true, mandatory: true, messageId: row.eventId, type: row.routingKey, contentType: 'application/cloudevents+json',
          headers: { 'x-correlation-id': row.envelope.correlationid, 'x-intento': 0 }
        }, (error) => finish(error ? 'CONFIRM_NACK' : undefined));
      } catch { finish('BROKER_UNAVAILABLE'); }
    }));
    let timedOut = false;
    await Promise.race([Promise.all(settled), new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, CONFIRM_TIMEOUT_MS).unref())]);
    if (timedOut) {
      const done = new Set([...report.published, ...report.failed.map((item) => item.seq)]);
      for (const row of rows) if (!done.has(row.seq)) report.failed.push({ seq: row.seq, code: 'CONFIRM_TIMEOUT' });
    }
    return report;
  }

  async close(): Promise<void> {
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}

/** Bus sobre RabbitMQ (amqplib). Abre la conexión solo durante una corrida: no hay consumidores permanentes (ADR-F12b-04). */
export class AmqpEventBus implements EventBus {
  constructor(private readonly url: string, private readonly topology: Topology, private readonly connectTimeoutMs: number) {}

  async open(): Promise<BusSession> {
    let connection: Connection | undefined;
    try {
      const connecting = amqp.connect(this.url);
      connection = await withTimeout(connecting, this.connectTimeoutMs, () => { void connecting.then((late) => late.close()).catch(() => undefined); });
      connection.on('error', () => undefined);
      const channel = await connection.createConfirmChannel();
      channel.on('error', () => undefined);
      const returned = new Set<string>();
      channel.on('return', (message) => { const id = message.properties.messageId; if (typeof id === 'string') returned.add(id); });
      await assertTopology(channel, this.topology);
      return new AmqpSession(connection, channel, this.topology.exchange, returned);
    } catch (thrown) {
      await connection?.close().catch(() => undefined);
      throw thrown instanceof BusUnavailableError ? thrown : new BusUnavailableError();
    }
  }

  async ping(): Promise<boolean> {
    try { await (await this.open()).close(); return true; } catch { return false; }
  }
}
