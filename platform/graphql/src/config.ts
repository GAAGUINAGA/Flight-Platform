import process from 'node:process';
import { URL } from 'node:url';

export interface JwtIssuer { iss: string; aud: string; jwksUri?: string; publicKeyFile?: string }
export interface GraphqlConfig {
  production: boolean; port: number; gatewayBaseUrl: string; jwtIssuers: JwtIssuer[]; corsOrigins: string[];
  maxDepth: number; maxComplexity: number; maxAliases: number; maxBodyBytes: number; maxVariablesBytes: number;
  operationTimeoutMs: number; gatewayTimeoutMs: number; introspection: boolean; knownOperationsOnly: boolean;
  rateLimitPerMin: number; rateLimitAuthPerMin: number;
}

const positive = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw); if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};
const flag = (raw: string | undefined, fallback: boolean): boolean => (raw === undefined || raw === '' ? fallback : raw === 'true');

/** Configuración desde variables de entorno. Falla al arrancar con valores inseguros en producción (sin valores por omisión que abran el servicio). */
export function loadConfig(env: Record<string, string | undefined> = process.env): GraphqlConfig {
  const production = env.NODE_ENV === 'production';
  const gatewayBaseUrl = (env.GATEWAY_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!gatewayBaseUrl) throw new Error('GATEWAY_BASE_URL is required');
  let gatewayUrl: URL; try { gatewayUrl = new URL(gatewayBaseUrl); } catch { throw new Error('GATEWAY_BASE_URL must be a valid URL'); }
  if (production && gatewayUrl.protocol !== 'https:') throw new Error('GATEWAY_BASE_URL must use https in production');
  let jwtIssuers: JwtIssuer[] = [];
  try { jwtIssuers = JSON.parse(env.JWT_ISSUERS ?? '[]') as JwtIssuer[]; } catch { throw new Error('JWT_ISSUERS must be valid JSON'); }
  if (!Array.isArray(jwtIssuers) || jwtIssuers.length === 0 || jwtIssuers.some((issuer) => !issuer || typeof issuer.iss !== 'string' || typeof issuer.aud !== 'string' || (!issuer.jwksUri && !issuer.publicKeyFile))) throw new Error('JWT_ISSUERS must list issuers with iss, aud and jwksUri or publicKeyFile');
  if (production && jwtIssuers.some((issuer) => !issuer.jwksUri)) throw new Error('JWT_ISSUERS must use jwksUri in production');
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (corsOrigins.includes('*')) throw new Error('CORS_ORIGINS must list exact origins (no wildcard)');
  if (production && corsOrigins.some((origin) => !origin.startsWith('https://'))) throw new Error('CORS_ORIGINS must use https origins in production');
  const knownOperationsOnly = flag(env.KNOWN_OPERATIONS_ONLY, production);
  if (production && !knownOperationsOnly) throw new Error('KNOWN_OPERATIONS_ONLY cannot be disabled in production');
  const introspection = flag(env.INTROSPECTION, !production);
  if (production && introspection) throw new Error('INTROSPECTION cannot be enabled in production');
  return {
    production, port: positive(env.PORT, 8080, 'PORT'), gatewayBaseUrl, jwtIssuers, corsOrigins,
    maxDepth: positive(env.MAX_QUERY_DEPTH, 8, 'MAX_QUERY_DEPTH'), maxComplexity: positive(env.MAX_COMPLEXITY, 4000, 'MAX_COMPLEXITY'), maxAliases: positive(env.MAX_ALIASES, 15, 'MAX_ALIASES'),
    maxBodyBytes: positive(env.MAX_BODY_BYTES, 100 * 1024, 'MAX_BODY_BYTES'), maxVariablesBytes: positive(env.MAX_VARIABLES_BYTES, 64 * 1024, 'MAX_VARIABLES_BYTES'),
    operationTimeoutMs: positive(env.OPERATION_TIMEOUT_MS, 10_000, 'OPERATION_TIMEOUT_MS'), gatewayTimeoutMs: positive(env.GATEWAY_TIMEOUT_MS, 8_000, 'GATEWAY_TIMEOUT_MS'),
    introspection, knownOperationsOnly, rateLimitPerMin: positive(env.RATE_LIMIT_PER_MIN, 120, 'RATE_LIMIT_PER_MIN'), rateLimitAuthPerMin: positive(env.RATE_LIMIT_AUTH_PER_MIN, 240, 'RATE_LIMIT_AUTH_PER_MIN')
  };
}
