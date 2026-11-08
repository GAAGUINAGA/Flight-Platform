import process from 'node:process';
import { Logger } from '@nestjs/common';
type Environment = Record<string, string | undefined>;

export interface JwtIssuer {
  iss: string;
  aud: string;
  role?: string;
  jwksUri?: string;
  publicKeyFile?: string;
}

export interface GatewayConfig {
  port: number;
  internalApiKey: string;
  jwtIssuers: JwtIssuer[];
  corsOrigins: string[];
  publicLimit: number;
  authLimit: number;
  idempotencyTtlHours: number;
  validateResponses: boolean;
  schedulerEnabled: boolean;
  schedulerEveryMs: number;
  schedulerPurgeEveryMs: number;
  schedulerBatchSize: number;
  schedulerLockLeaseMs: number;
  grpcTls: boolean;
  /** Cómo llega el Gateway a los microservicios (ADR-F12b-03): por el ESB (por defecto) o directo por gRPC (vuelta atrás hasta F12b-3). */
  transport: 'esb' | 'grpc';
  /** URL base del ESB, sin barra final. */
  esbUrl: string;
  /** `true` si ESB_URL vino explícita; `main.ts` la exige en producción con transporte esb. */
  esbUrlConfigured: boolean;
  v2?: V2Config;
}

/** Configuración de la fachada v2 y del dev-auth (F12a). Los valores por defecto son los de producción. */
export interface V2Config {
  nodeId: string;
  providerName: string;
  /** URL pública sin barra final: emisor del dev-auth y base de los `_links`. */
  publicBaseUrl: string;
  /** Perfil de integración local (Tailscale): solo por variable explícita y nunca con NODE_ENV=production. */
  integrationLocal: boolean;
  devAuth: { enabled: boolean; requireKey: boolean; publicBaseUrlConfigured: boolean; privateKeyPem?: string; privateKeyFile?: string; ttlSeconds: number; store: 'prisma' | 'memory'; failureLimit: number };
  healthTimeoutMs: number;
  healthCacheMs: number;
  /** Dónde vive el estado propio de v2 (reservas, eventos procesados). En pruebas es memoria salvo V2_STATE_STORE=prisma. */
  stateStore: 'prisma' | 'memory';
  /** Código de la aerolínea en el `source` de los CloudEvents: /aerolineas/<código>/vuelos. */
  sourceCode: string;
  /** Ventana, desde que se creó la reserva, en la que una SAGA_COMPENSATION no paga penalidad (D5). Fuera de ella aplica la de la tarifa. */
  sagaWaiverMinutes: number;
  /** Envío de stock a Booking por gRPC. Sin `apiKey` queda apagado. TLS solo se desactiva con INTEGRATION_LOCAL=true. */
  stock: { enabled: boolean; url?: string; tls: boolean; caFile?: string; apiKey?: string; timeoutMs: number; store: 'prisma' | 'memory' };
  /** POST /api/v2/vuelos/booking-events: HMAC-SHA256 del cuerpo con un secreto compartido. Sin secreto el endpoint rechaza todo. */
  bookingEvents: { secret?: string; signatureHeader: string; signaturePrefix: string; clientId?: string };
}

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export function loadConfig(env: Environment = process.env): GatewayConfig {
  let jwtIssuers: JwtIssuer[];
  try { jwtIssuers = JSON.parse(required(env.JWT_ISSUERS, 'JWT_ISSUERS')) as JwtIssuer[]; } catch { throw new Error('JWT_ISSUERS must be a JSON array'); }
  if (!Array.isArray(jwtIssuers) || jwtIssuers.length === 0) throw new Error('JWT_ISSUERS must contain at least one issuer');
  for (const issuer of jwtIssuers) {
    if (!issuer.iss || !issuer.aud || (!!issuer.jwksUri === !!issuer.publicKeyFile)) throw new Error('Each JWT issuer requires iss, aud and exactly one key source');
    if (env.NODE_ENV === 'production' && (issuer.publicKeyFile || issuer.iss === 'flight-platform-dev')) throw new Error('Development JWT issuers are forbidden in production');
  }
  const port = Number(env.PORT ?? 3000);
  const production = env.NODE_ENV === 'production';
  const integrationLocal = env.INTEGRATION_LOCAL === 'true';
  if (integrationLocal && production) throw new Error('INTEGRATION_LOCAL is forbidden in production');
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '') || `http://localhost:${port}`;
  if (env.PUBLIC_BASE_URL && production && !publicBaseUrl.startsWith('https://')) throw new Error('PUBLIC_BASE_URL must use https in production');
  if (env.PUBLIC_BASE_URL && !/^https?:\/\/[^\s/]+$/.test(publicBaseUrl)) throw new Error('PUBLIC_BASE_URL must be an origin without path');
  const stockTls = env.BOOKING_STOCK_TLS !== 'false';
  if (!stockTls && !integrationLocal) throw new Error('BOOKING_STOCK_TLS=false requires INTEGRATION_LOCAL=true');
  // ADR-F12b1fix-02: las zonas de los aeropuertos salen de `@flight-platform/shared` (AIRPORT_ZONES); la variable quedó obsoleta.
  if (env.AIRPORT_TIMEZONES) new Logger('Config').warn('AIRPORT_TIMEZONES está obsoleta y se ignora: las zonas horarias están en @flight-platform/shared (AIRPORT_ZONES)');
  // Con booking-events habilitado (secreto configurado) el evento solo puede tocar reservas de un cliente: sin BOOKING_EVENTS_CLIENT_ID se negaría el aislamiento. Las suites con NODE_ENV=test crean un cliente por escenario y quedan fuera.
  if (env.BOOKING_EVENTS_SECRET && !env.BOOKING_EVENTS_CLIENT_ID && env.NODE_ENV !== 'test') throw new Error('BOOKING_EVENTS_CLIENT_ID is required when BOOKING_EVENTS_SECRET is configured');
  // Ninguna dirección ni clave de Booking va en el código: sin URL y clave el stock queda apagado (el TLS es obligatorio en producción: BOOKING_STOCK_TLS=false exige INTEGRATION_LOCAL, prohibido allí).
  const stockApiKey = env.BOOKING_STOCK_API_KEY || undefined;
  const stockUrl = env.BOOKING_STOCK_GRPC_URL?.trim() || undefined;
  const devAuthKeyConfigured = Boolean(env.DEV_AUTH_PRIVATE_KEY);
  // En producción la llave de firma sale de una variable de entorno (o de Secret Manager inyectado como variable), nunca de un archivo, y el servicio no arranca sin ella.
  if (production && env.DEV_AUTH_PRIVATE_KEY_FILE) throw new Error('DEV_AUTH_PRIVATE_KEY_FILE is forbidden in production: use DEV_AUTH_PRIVATE_KEY');
  const v2: V2Config = {
    nodeId: env.NODE_ID ?? 'NODE_VUE_GABATAIR', providerName: env.PROVIDER_NAME ?? 'GabatAIR', publicBaseUrl, integrationLocal,
    devAuth: {
      // En producción el dev-auth exige llave y URL pública explícitas; sin ellas queda apagado en lugar de generar una llave efímera.
      // Con producción y sin DEV_AUTH_ENABLED=false, DevAuthService.create se niega a arrancar sin llave en variable de entorno y sin PUBLIC_BASE_URL explícita.
      requireKey: production && env.DEV_AUTH_ENABLED !== 'false', publicBaseUrlConfigured: Boolean(env.PUBLIC_BASE_URL),
      enabled: env.DEV_AUTH_ENABLED === 'false' ? false : !production || (devAuthKeyConfigured && Boolean(env.PUBLIC_BASE_URL)),
      privateKeyPem: env.DEV_AUTH_PRIVATE_KEY, privateKeyFile: env.DEV_AUTH_PRIVATE_KEY_FILE,
      ttlSeconds: Number(env.DEV_AUTH_TOKEN_TTL_SECONDS ?? 3600), store: env.DEV_AUTH_STORE === 'memory' || (env.NODE_ENV === 'test' && env.DEV_AUTH_STORE !== 'prisma') ? 'memory' : 'prisma',
      failureLimit: Number(env.DEV_AUTH_FAILURE_LIMIT_PER_MIN ?? 10)
    },
    healthTimeoutMs: Number(env.HEALTH_TIMEOUT_MS ?? 800), healthCacheMs: Number(env.HEALTH_CACHE_MS ?? 5000),
    stock: { enabled: Boolean(stockApiKey) && Boolean(stockUrl) && env.STOCK_SYNC_ENABLED !== 'false', url: stockUrl, tls: stockTls, caFile: env.BOOKING_STOCK_TLS_CA_FILE || undefined, apiKey: stockApiKey, timeoutMs: Number(env.BOOKING_STOCK_TIMEOUT_MS ?? 3000), store: env.V2_STATE_STORE === 'memory' || (env.NODE_ENV === 'test' && env.V2_STATE_STORE !== 'prisma') ? 'memory' : 'prisma' },
    sourceCode: env.WEBHOOK_SOURCE_CODE ?? 'gabatair', sagaWaiverMinutes: Number(env.SAGA_PENALTY_WAIVER_MINUTES ?? 120),
    bookingEvents: { secret: env.BOOKING_EVENTS_SECRET || undefined, signatureHeader: (env.BOOKING_EVENTS_SIGNATURE_HEADER ?? 'x-webhook-signature').toLowerCase(), signaturePrefix: env.BOOKING_EVENTS_SIGNATURE_PREFIX ?? 'sha256=', clientId: env.BOOKING_EVENTS_CLIENT_ID || undefined },
    stateStore: env.V2_STATE_STORE === 'memory' || (env.NODE_ENV === 'test' && env.V2_STATE_STORE !== 'prisma') ? 'memory' : 'prisma'
  };
  // Las suites pasan un entorno explícito que no copia process.env: sin este respaldo no podrían elegir el transporte desde la línea de comandos.
  // En producción `env` es process.env, así que el respaldo no cambia nada.
  const transport = env.GATEWAY_TRANSPORT ?? process.env.GATEWAY_TRANSPORT ?? 'esb';
  if (transport !== 'esb' && transport !== 'grpc') throw new Error('GATEWAY_TRANSPORT must be esb or grpc');
  const esbUrl = (env.ESB_URL ?? process.env.ESB_URL ?? '').trim().replace(/\/+$/, '');
  if (esbUrl && !/^https?:\/\/[^\s/]+$/.test(esbUrl)) throw new Error('ESB_URL must be an origin without path');
  return {
    transport, esbUrl: esbUrl || 'http://localhost:3100', esbUrlConfigured: Boolean(esbUrl),
    v2, port, internalApiKey: required(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY'), jwtIssuers,
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((x: string) => x.trim()).filter(Boolean),
    publicLimit: Number(env.RATE_LIMIT_PUBLIC_PER_MIN ?? 60), authLimit: Number(env.RATE_LIMIT_AUTH_PER_MIN ?? 120),
    idempotencyTtlHours: Number(env.IDEMPOTENCY_TTL_HOURS ?? 24),
    validateResponses: env.VALIDATE_RESPONSES === undefined ? (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') : env.VALIDATE_RESPONSES === 'true',
    schedulerEnabled: env.SCHEDULER_ENABLED === 'true', schedulerEveryMs: Number(env.SCHEDULER_EVERY_MS ?? 60_000), schedulerPurgeEveryMs: Number(env.SCHEDULER_PURGE_EVERY_MS ?? 3_600_000), schedulerBatchSize: Number(env.SCHEDULER_BATCH_SIZE ?? 50), schedulerLockLeaseMs: Number(env.SCHEDULER_LOCK_LEASE_MS ?? 55_000), grpcTls: env.GRPC_TLS === 'true'
  };
}

export const grpcUrl = (service: string, env: Environment = process.env): string => env[`${service.toUpperCase()}_GRPC_URL`] ?? `localhost:${({ inventory: 50051, pricing: 50052, ancillaries: 50053, reservation: 50054, ticketing: 50055, operations: 50056, webhooks: 50057 } as Record<string, number>)[service]}`;
