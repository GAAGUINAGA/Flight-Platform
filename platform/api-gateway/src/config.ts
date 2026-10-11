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
  grpcTls: boolean;
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
  return {
    port: Number(env.PORT ?? 3000), internalApiKey: required(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY'), jwtIssuers,
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((x: string) => x.trim()).filter(Boolean),
    publicLimit: Number(env.RATE_LIMIT_PUBLIC_PER_MIN ?? 60), authLimit: Number(env.RATE_LIMIT_AUTH_PER_MIN ?? 120),
    idempotencyTtlHours: Number(env.IDEMPOTENCY_TTL_HOURS ?? 24),
    validateResponses: env.VALIDATE_RESPONSES === undefined ? (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') : env.VALIDATE_RESPONSES === 'true',
    schedulerEnabled: env.SCHEDULER_ENABLED === 'true', grpcTls: env.GRPC_TLS === 'true'
  };
}

export const grpcUrl = (service: string, env: Environment = process.env): string => env[`${service.toUpperCase()}_GRPC_URL`] ?? `localhost:${({ inventory: 50051, pricing: 50052, ancillaries: 50053, reservation: 50054, ticketing: 50055, operations: 50056, webhooks: 50057 } as Record<string, number>)[service]}`;
