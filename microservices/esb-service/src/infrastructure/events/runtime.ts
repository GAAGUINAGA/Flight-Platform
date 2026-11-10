import { OutboxEventOperations } from '../../application/event-operations';
import type { EventOperations } from '../../application/event-ports';
import type { EsbConfig } from '../../config';
import { topologyFor, WEBHOOKS_BINDINGS, WEBHOOKS_QUEUE } from '../../domain/events';
import { PrismaClient } from '../persistence/prisma-client/client';
import { PrismaEventOutbox } from '../persistence/prisma-event-outbox';
import { AmqpEventBus } from './amqp-event-bus';

/** Estado del bus para `GET /health/deps` (aparte de `sistema.salud`, que sigue siendo de siete dependencias). */
export interface BusHealth { broker: 'UP' | 'DOWN'; outboxPendientes: number | null }
export interface EventRuntime { operations: EventOperations; health(): Promise<BusHealth>; close(): Promise<void> }

/** Compone los adaptadores reales del bus (Prisma sobre el esquema `esb` y RabbitMQ). Falla rápido si falta alguna conexión (ESB_EVENTS_MODE=outbox). */
export function buildEventRuntime(config: EsbConfig): EventRuntime {
  const { databaseUrl, rabbitmqUrl, limits, retryTtlsMs, connectTimeoutMs } = config.events;
  if (!databaseUrl || !rabbitmqUrl) throw new Error('DATABASE_URL and RABBITMQ_URL are required when ESB_EVENTS_MODE=outbox');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const outbox = new PrismaEventOutbox(prisma);
  const bus = new AmqpEventBus(rabbitmqUrl, topologyFor(WEBHOOKS_QUEUE, WEBHOOKS_BINDINGS, retryTtlsMs), connectTimeoutMs);
  return {
    operations: new OutboxEventOperations(outbox, bus, limits),
    health: async () => ({ broker: (await bus.ping()) ? 'UP' : 'DOWN', outboxPendientes: await outbox.pendingCount().catch(() => null) }),
    close: () => prisma.$disconnect()
  };
}
