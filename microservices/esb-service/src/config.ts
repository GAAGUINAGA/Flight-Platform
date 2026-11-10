import process from 'node:process';
import { SERVICES, type ServiceName } from './domain/catalog';
import type { DeadlinePolicy } from './domain/deadline';
import { DEFAULT_RETRY_TTLS_MS } from './domain/events';
import { DEFAULT_EVENT_LIMITS, type EventLimits } from './application/event-operations';

export type Environment = Record<string, string | undefined>;
const DEFAULT_PORTS: Record<ServiceName, number> = { inventory: 50051, pricing: 50052, ancillaries: 50053, reservation: 50054, ticketing: 50055, operations: 50056, webhooks: 50057 };

/** Bus de eventos (ADR-F12b-04/05/06). `outbox` escribe en el esquema `esb` y publica a RabbitMQ; `grpc` reenvía a Webhooks como antes de F12b-2. */
export interface EventsConfig {
  mode: 'outbox' | 'grpc'; databaseUrl?: string; rabbitmqUrl?: string; limits: EventLimits; retryTtlsMs: number[]; connectTimeoutMs: number;
}

export interface EsbConfig {
  port: number; bindHost: string; internalApiKey: string; grpcTls: boolean;
  grpcUrls: Record<ServiceName, string>; deadlines: DeadlinePolicy; maxBodyBytes: number; events: EventsConfig;
}

const retryTtls = (env: Environment): number[] => {
  const raw = env.EVENTS_RETRY_TTLS_MS;
  if (raw === undefined || raw === '') return [...DEFAULT_RETRY_TTLS_MS];
  const values = raw.split(',').map((part) => Number(part.trim()));
  if (values.length === 0 || values.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error('EVENTS_RETRY_TTLS_MS must be a comma-separated list of positive integers');
  return values;
};

function eventsConfig(env: Environment, local: boolean): EventsConfig {
  const mode = env.ESB_EVENTS_MODE ?? 'outbox';
  if (mode !== 'outbox' && mode !== 'grpc') throw new Error('ESB_EVENTS_MODE must be outbox or grpc');
  const rabbitmqUrl = env.RABBITMQ_URL || undefined;
  // En producción el broker se alcanza por TLS (amqps); solo el perfil de integración local admite amqp (BUS-SEC4).
  if (rabbitmqUrl && env.NODE_ENV === 'production' && !local && !rabbitmqUrl.startsWith('amqps://')) throw new Error('RABBITMQ_URL must use amqps in production');
  const d = DEFAULT_EVENT_LIMITS;
  return {
    mode, databaseUrl: env.DATABASE_URL || undefined, rabbitmqUrl, retryTtlsMs: retryTtls(env), connectTimeoutMs: positiveInt(env, 'RABBITMQ_CONNECT_TIMEOUT_MS', 3_000),
    limits: {
      maxEventBytes: positiveInt(env, 'ESB_EVENT_MAX_BYTES', d.maxEventBytes), publishBatch: positiveInt(env, 'EVENTS_PUBLISH_BATCH', d.publishBatch),
      publishMaxBatches: positiveInt(env, 'EVENTS_PUBLISH_MAX_BATCHES', d.publishMaxBatches), leaseMs: positiveInt(env, 'ESB_OUTBOX_LEASE_MS', d.leaseMs),
      retentionDays: positiveInt(env, 'ESB_OUTBOX_RETENTION_DAYS', d.retentionDays)
    }
  };
}

const positiveInt = (env: Environment, name: string, fallback: number): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

/** Lee la configuración del entorno. Falla rápido si falta la llave interna; los plazos y tamaños tienen valor por defecto (PLAN §1.2). */
export function loadConfig(env: Environment = process.env, source: { envFileLoaded?: boolean } = {}): EsbConfig {
  const internalApiKey = env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error(source.envFileLoaded ? 'INTERNAL_API_KEY is required (the .env file was loaded but does not define it: check the variable name and that the file is UTF-8)' : 'INTERNAL_API_KEY is required');
  const local = env.INTEGRATION_LOCAL === 'true';
  if (local && env.NODE_ENV === 'production') throw new Error('INTEGRATION_LOCAL is forbidden in production');
  const maxMs = positiveInt(env, 'ESB_MAX_DEADLINE_MS', 30_000);
  const grpcUrls = Object.fromEntries(SERVICES.map((service) => [service, env[`${service.toUpperCase()}_GRPC_URL`] ?? `localhost:${DEFAULT_PORTS[service]}`])) as Record<ServiceName, string>;
  return {
    port: positiveInt(env, 'PORT', 8080), bindHost: env.ESB_BIND_HOST ?? (local ? '127.0.0.1' : '0.0.0.0'), internalApiKey, grpcTls: env.GRPC_TLS === 'true', grpcUrls,
    deadlines: { defaultMs: positiveInt(env, 'ESB_DEFAULT_DEADLINE_MS', 5_000), orchestratedMs: Math.min(positiveInt(env, 'ESB_ORCHESTRATED_DEADLINE_MS', 30_000), maxMs), maxMs },
    maxBodyBytes: positiveInt(env, 'ESB_MAX_BODY_BYTES', 1_048_576), events: eventsConfig(env, local)
  };
}
