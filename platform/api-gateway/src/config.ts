import process from 'node:process';
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
  devAuth: { enabled: boolean; privateKeyPem?: string; privateKeyFile?: string; ttlSeconds: number; store: 'prisma' | 'memory'; failureLimit: number };
  healthTimeoutMs: number;
  healthCacheMs: number;
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
  const devAuthKeyConfigured = Boolean(env.DEV_AUTH_PRIVATE_KEY || env.DEV_AUTH_PRIVATE_KEY_FILE);
  const v2: V2Config = {
    nodeId: env.NODE_ID ?? 'NODE_VUE_GABATAIR', providerName: env.PROVIDER_NAME ?? 'GabatAIR', publicBaseUrl, integrationLocal,
    devAuth: {
      // En producción el dev-auth exige llave y URL pública explícitas; sin ellas queda apagado en lugar de generar una llave efímera.
      enabled: env.DEV_AUTH_ENABLED === 'false' ? false : !production || (devAuthKeyConfigured && Boolean(env.PUBLIC_BASE_URL)),
      privateKeyPem: env.DEV_AUTH_PRIVATE_KEY, privateKeyFile: env.DEV_AUTH_PRIVATE_KEY_FILE,
      ttlSeconds: Number(env.DEV_AUTH_TOKEN_TTL_SECONDS ?? 3600), store: env.DEV_AUTH_STORE === 'memory' || (env.NODE_ENV === 'test' && env.DEV_AUTH_STORE !== 'prisma') ? 'memory' : 'prisma',
      failureLimit: Number(env.DEV_AUTH_FAILURE_LIMIT_PER_MIN ?? 10)
    },
    healthTimeoutMs: Number(env.HEALTH_TIMEOUT_MS ?? 800), healthCacheMs: Number(env.HEALTH_CACHE_MS ?? 5000)
  };
  return {
    v2, port, internalApiKey: required(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY'), jwtIssuers,
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((x: string) => x.trim()).filter(Boolean),
    publicLimit: Number(env.RATE_LIMIT_PUBLIC_PER_MIN ?? 60), authLimit: Number(env.RATE_LIMIT_AUTH_PER_MIN ?? 120),
    idempotencyTtlHours: Number(env.IDEMPOTENCY_TTL_HOURS ?? 24),
    validateResponses: env.VALIDATE_RESPONSES === undefined ? (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') : env.VALIDATE_RESPONSES === 'true',
    schedulerEnabled: env.SCHEDULER_ENABLED === 'true', schedulerEveryMs: Number(env.SCHEDULER_EVERY_MS ?? 60_000), schedulerPurgeEveryMs: Number(env.SCHEDULER_PURGE_EVERY_MS ?? 3_600_000), schedulerBatchSize: Number(env.SCHEDULER_BATCH_SIZE ?? 50), schedulerLockLeaseMs: Number(env.SCHEDULER_LOCK_LEASE_MS ?? 55_000), grpcTls: env.GRPC_TLS === 'true'
  };
}

export const grpcUrl = (service: string, env: Environment = process.env): string => env[`${service.toUpperCase()}_GRPC_URL`] ?? `localhost:${({ inventory: 50051, pricing: 50052, ancillaries: 50053, reservation: 50054, ticketing: 50055, operations: 50056, webhooks: 50057 } as Record<string, number>)[service]}`;
