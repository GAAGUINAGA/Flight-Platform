import { Buffer } from 'node:buffer';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knownOperations } from '@flight-platform/graphql-schema';
import request from 'supertest';
import { createDevToken } from '../../../infra/scripts/dev-token';
import type { GatewayPort, GatewayRequest, GatewayResponse } from '../src/application/ports';
import { loadConfig, type GraphqlConfig } from '../src/config';
import { createApp } from '../src/infrastructure/app';
import type { AuditLog, LogEntry } from '../src/infrastructure/audit-log';
import { JoseTokenVerifier } from '../src/infrastructure/jwt-verifier';
import { RateLimiter } from '../src/infrastructure/rate-limit';
import { buildServiceSchema } from '../src/infrastructure/schema';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
const dir = mkdtempSync(join(tmpdir(), 'graphql-test-')); const publicKeyFile = join(dir, 'public.pem'); writeFileSync(publicKeyFile, keys.publicKey);
export const cleanupKeys = (): void => rmSync(dir, { recursive: true, force: true });
export const ISSUER = { iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile };

const USER_SCOPES = 'flights:read flights:hold flights:book flights:cancel';
export const tokenFor = (sub: string, role: 'customer' | 'admin' | 'partner' = 'customer', options: { iss?: string; aud?: string; now?: number } = {}): string =>
  createDevToken(keys.privateKey, { sub, app_role: role, scope: role === 'admin' ? `${USER_SCOPES} flights:admin` : USER_SCOPES }, options.now, { iss: options.iss, aud: options.aud });
export const bearer = (token: string): string => `Bearer ${token}`;

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
/** Tokens falsificados para las pruebas de autenticación (sin firma, HS256 con la llave pública como secreto, firma alterada). */
export const forged = {
  none: (): string => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'x', app_role: 'admin', iss: ISSUER.iss, aud: ISSUER.aud, exp: Math.floor(Date.now() / 1000) + 3600 })}.`,
  hs256: (): string => { const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'x', app_role: 'admin', iss: ISSUER.iss, aud: ISSUER.aud, exp: Math.floor(Date.now() / 1000) + 3600 })}`; const signature = createHmac('sha256', keys.publicKey).update(input).digest('base64url'); return `${input}.${signature}`; },
  badSignature: (token: string): string => { const [h, p, s] = token.split('.'); return `${h}.${p}.${s.slice(0, -4)}AAAA`; }
};

export interface Call extends GatewayRequest { at: number }
export type Responder = (request: GatewayRequest) => Partial<GatewayResponse> & { status: number } | undefined;
/** Gateway simulado: registra cada llamada y responde con lo que decida `responder` (404 si nada coincide). */
export class FakeGateway implements GatewayPort {
  readonly calls: Call[] = [];
  constructor(public responder: Responder = () => undefined) {}
  async send(request: GatewayRequest): Promise<GatewayResponse> {
    this.calls.push({ ...request, at: Date.now() });
    const answer = this.responder(request) ?? { status: 404, body: { type: 'x', title: 'No encontrado', status: 404, code: 'NOT_FOUND' } };
    return { status: answer.status, body: answer.body, retryAfter: answer.retryAfter ?? null, invalidBody: answer.invalidBody ?? false };
  }
}

export class MemoryLog implements AuditLog { readonly entries: LogEntry[] = []; record(entry: LogEntry): void { this.entries.push(entry); } }

export const baseEnv = { NODE_ENV: 'test', GATEWAY_BASE_URL: 'http://gateway.test', JWT_ISSUERS: JSON.stringify([ISSUER]), CORS_ORIGINS: 'https://web.example' };
export function makeApp(overrides: Record<string, string> = {}, gateway: FakeGateway = new FakeGateway(), limiter?: RateLimiter) {
  const config: GraphqlConfig = loadConfig({ ...baseEnv, ...overrides }); const log = new MemoryLog();
  const app = createApp({ config, schema: buildServiceSchema(), gateway, verifier: new JoseTokenVerifier(config.jwtIssuers), known: knownOperations(), log, ...(limiter ? { limiter } : {}) });
  return { app, gateway, log, config };
}

export const operationText = (name: string): string => { const text = knownOperations().get(name); if (!text) throw new Error(`operación desconocida ${name}`); return text; };
export interface Reply { status: number; body: { data?: Record<string, unknown> | null; errors?: Array<{ message: string; path?: unknown[]; extensions: Record<string, unknown> }> }; headers: Record<string, string> }
/** Ejecuta una operación publicada contra la app (con token y huella opcionales). */
export async function run(app: ReturnType<typeof makeApp>['app'], name: string, variables: Record<string, unknown> = {}, options: { token?: string; fingerprint?: string; correlationId?: string; extra?: Record<string, string> } = {}): Promise<Reply> {
  let call = request(app).post('/graphql').set('Content-Type', 'application/json');
  if (options.token) call = call.set('Authorization', bearer(options.token)); if (options.fingerprint) call = call.set('X-Device-Fingerprint', options.fingerprint); if (options.correlationId) call = call.set('X-Correlation-Id', options.correlationId);
  for (const [name_, value] of Object.entries(options.extra ?? {})) call = call.set(name_, value);
  const response = await call.send({ query: operationText(name), operationName: name, variables });
  return { status: response.status, body: response.body, headers: response.headers as Record<string, string> };
}
export const UUID_A = '11111111-1111-4111-8111-111111111111'; export const UUID_B = '22222222-2222-4222-8222-222222222222'; export const FINGERPRINT = 'device-0123456789abcdef';
