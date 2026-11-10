import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import amqp from 'amqplib';
import type { BusBatch, BusMessage, EventBusConsumer } from '../../application/ports';

type Env = Record<string, string | undefined>;

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;
type Delivered = Exclude<Awaited<ReturnType<ConfirmChannel['get']>>, false>;
const CONFIRM_TIMEOUT_MS = 10_000;

/** Cola ausente o canal cerrado por el broker: se trata como lote vacío, nunca como error de la corrida. */
const EMPTY: BusBatch = { next: async () => undefined, close: async () => undefined };

class AmqpBatch implements BusBatch {
  private returned = false;
  constructor(private readonly connection: Connection, private readonly channel: ConfirmChannel, private readonly queue: string) {
    channel.on('return', () => { this.returned = true; });
  }

  async next(): Promise<BusMessage | undefined> {
    const delivered = await this.channel.get(this.queue, { noAck: false });
    if (!delivered) return undefined;
    return this.wrap(delivered);
  }

  private wrap(delivered: Delivered): BusMessage {
    const attemptHeader = delivered.properties.headers?.['x-intento'];
    return {
      body: delivered.content.toString('utf8'), attempt: typeof attemptHeader === 'number' && attemptHeader >= 0 ? attemptHeader : 0,
      ack: async () => { this.channel.ack(delivered); },
      requeue: async () => { this.channel.nack(delivered, false, true); },
      moveTo: async (queue, attempt, reason) => {
        this.returned = false;
        // Publicación al exchange por defecto con `mandatory`: una cola inexistente se detecta (basic.return) y el original no se confirma.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('confirm timeout')), CONFIRM_TIMEOUT_MS);
          this.channel.sendToQueue(queue, delivered.content, {
            persistent: true, mandatory: true, contentType: delivered.properties.contentType, messageId: delivered.properties.messageId, type: delivered.properties.type,
            headers: { ...delivered.properties.headers, 'x-intento': attempt, ...(reason ? { 'x-motivo': reason } : {}) }
          }, (error) => { clearTimeout(timer); if (error) reject(new Error('publish nack')); else resolve(); });
        });
        if (this.returned) throw new Error('queue not found');
        this.channel.ack(delivered);
      }
    };
  }

  async close(): Promise<void> {
    // Los mensajes retirados y sin confirmar vuelven a la cola al cerrar el canal.
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}

/** Consumo por lotes con `basic.get` (ADR-F12b-04). Una conexión por corrida; Webhooks no declara la topología (la declara el ESB). */
export class AmqpEventBusConsumer implements EventBusConsumer {
  constructor(private readonly url: string, private readonly queue: string, private readonly connectTimeoutMs: number) {}

  async open(): Promise<BusBatch> {
    const connecting = amqp.connect(this.url);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connection = await Promise.race([connecting, new Promise<never>((_, reject) => { timer = setTimeout(() => { void connecting.then((late) => late.close()).catch(() => undefined); reject(new Error('bus connect timeout')); }, this.connectTimeoutMs); })]).finally(() => clearTimeout(timer));
    connection.on('error', () => undefined);
    try {
      const probe = await connection.createChannel();
      probe.on('error', () => undefined);
      try { await probe.checkQueue(this.queue); } catch { await connection.close().catch(() => undefined); return EMPTY; }
      await probe.close().catch(() => undefined);
      const channel = await connection.createConfirmChannel();
      channel.on('error', () => undefined);
      return new AmqpBatch(connection, channel, this.queue);
    } catch (error) { await connection.close().catch(() => undefined); throw error; }
  }
}

/** En producción sin `RABBITMQ_URL` Webhooks solo entrega y no retira eventos del bus: avisa al arrancar (JSON en stderr) en vez de fallar en silencio. */
export function warnIfBusNotConsumed(env: Env, write: (line: string) => void = (line) => { process.stderr.write(line); }): string | undefined {
  if (env.NODE_ENV !== 'production' || env.RABBITMQ_URL) return undefined;
  const message = 'webhooks-service: RABBITMQ_URL is not set in production; the event bus will not be consumed (delivery-only rollback mode): events published through the ESB outbox are not ingested';
  write(`${JSON.stringify({ level: 'warn', service: 'webhooks-service', dependency: 'event-bus', message })}\n`);
  return message;
}

/** Crea el consumidor desde el entorno, o `undefined` si no hay broker configurado (modo de vuelta atrás: Webhooks solo entrega). */
export function busConsumerFromEnv(env: Env, queue: string): EventBusConsumer | undefined {
  const url = env.RABBITMQ_URL;
  if (!url) return undefined;
  // En producción el broker se alcanza por TLS; solo el perfil de integración local admite amqp (BUS-SEC4).
  if (env.NODE_ENV === 'production' && env.INTEGRATION_LOCAL !== 'true' && !url.startsWith('amqps://')) throw new Error('RABBITMQ_URL must use amqps in production');
  const timeout = Number(env.RABBITMQ_CONNECT_TIMEOUT_MS ?? 3000);
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error('RABBITMQ_CONNECT_TIMEOUT_MS must be a positive integer');
  return new AmqpEventBusConsumer(url, queue, timeout);
}
