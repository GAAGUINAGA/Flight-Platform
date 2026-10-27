import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, scrypt, timingSafeEqual, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { calculateJwkThumbprint, exportJWK, jwtVerify, SignJWT, type JWK } from 'jose';
import type { V2Config } from '../config';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;

export const DEV_AUTH_SCOPES = ['flights:read', 'flights:hold', 'flights:book', 'flights:cancel', 'flights:webhooks', 'flights:ops', 'flights:admin'] as const;
export const DEV_AUTH_AUDIENCE = 'flight-platform';
/** El identificador del cliente nunca contiene `~`: es el separador del dueño compuesto `<clientId>~<X-User-Id>` (D1). */
export const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
const CLIENT_CACHE_MS = 5_000;

export interface DevAuthClientRecord { clientId: string; secretHash: string; scopes: string[]; active: boolean; name?: string; }
export interface DevAuthClientStore {
  find(clientId: string): Promise<DevAuthClientRecord | null>;
  create(record: DevAuthClientRecord): Promise<void>;
  setActive(clientId: string, active: boolean): Promise<void>;
}

export class InMemoryDevAuthClientStore implements DevAuthClientStore {
  private readonly clients = new Map<string, DevAuthClientRecord>();
  async find(clientId: string): Promise<DevAuthClientRecord | null> { return this.clients.get(clientId) ?? null; }
  async create(record: DevAuthClientRecord): Promise<void> { if (this.clients.has(record.clientId)) throw new Error('client already exists'); this.clients.set(record.clientId, { ...record }); }
  async setActive(clientId: string, active: boolean): Promise<void> { const found = this.clients.get(clientId); if (found) found.active = active; }
}

// scrypt con sal por cliente; el formato incluye los parámetros para poder endurecerlos sin invalidar hashes previos.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export async function hashClientSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(secret, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}
export async function verifyClientSecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const derived = await scryptAsync(secret, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
/** Secreto de cliente de 256 bits. Quien lo crea es responsable de entregarlo una sola vez; en base solo queda el hash. */
export const generateClientSecret = (): string => randomBytes(32).toString('base64url');

export class OAuthError extends Error {
  constructor(public readonly httpStatus: number, public readonly oauthError: string, public readonly description?: string, public readonly challenge = false) { super(oauthError); }
}

export interface DevAuthPrincipal { clientId: string; scopes: Set<string>; }

export class DevAuthService {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  private constructor(private readonly config: V2Config, private readonly store: DevAuthClientStore, private readonly privateKey: KeyObject, private readonly publicKey: KeyObject, private readonly jwk: JWK, private readonly dummyHash: string) {}

  static async create(config: V2Config, store: DevAuthClientStore): Promise<DevAuthService> {
    let privateKey: KeyObject;
    const pem = config.devAuth.privateKeyPem ? config.devAuth.privateKeyPem.replace(/\\n/g, '\n') : config.devAuth.privateKeyFile ? readFileSync(config.devAuth.privateKeyFile, 'utf8') : undefined;
    if (pem) privateKey = createPrivateKey(pem);
    else privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const publicKey = createPublicKey(privateKey);
    const jwk = await exportJWK(publicKey);
    jwk.kid = await calculateJwkThumbprint(jwk); jwk.alg = 'RS256'; jwk.use = 'sig';
    return new DevAuthService(config, store, privateKey, publicKey, jwk, await hashClientSecret(randomBytes(8).toString('hex')));
  }

  get enabled(): boolean { return this.config.devAuth.enabled; }
  get issuer(): string { return `${this.config.publicBaseUrl}/api/v2`; }
  jwks(): { keys: JWK[] } { return { keys: this.enabled ? [this.jwk] : [] }; }
  get ttlSeconds(): number { return this.config.devAuth.ttlSeconds; }

  private tooManyFailures(clientId: string): boolean {
    const state = this.failures.get(clientId);
    return Boolean(state && state.resetAt > Date.now() && state.count >= this.config.devAuth.failureLimit);
  }
  private recordFailure(clientId: string): void {
    const now = Date.now(); const state = this.failures.get(clientId);
    if (this.failures.size > 5000) this.failures.clear();
    this.failures.set(clientId, !state || state.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { count: state.count + 1, resetAt: state.resetAt });
  }

  /** `client_credentials` (RFC 6749 §4.4). Los errores son OAuthError y nunca contienen el secreto recibido. */
  async issue(input: { clientId?: string; clientSecret?: string; scope?: string; viaBasic: boolean }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const { clientId, clientSecret } = input;
    if (!clientId || !clientSecret) throw new OAuthError(401, 'invalid_client', 'Credenciales de cliente ausentes', input.viaBasic);
    if (this.tooManyFailures(clientId)) throw new OAuthError(429, 'temporarily_unavailable', 'Demasiados intentos fallidos; reintente en un minuto');
    const client = CLIENT_ID_PATTERN.test(clientId) ? await this.store.find(clientId) : null;
    // Con cliente desconocido se verifica contra un hash señuelo para no revelar su existencia por tiempo de respuesta.
    const valid = await verifyClientSecret(clientSecret, client?.secretHash ?? this.dummyHash);
    if (!client || !client.active || !valid) { this.recordFailure(clientId); throw new OAuthError(401, 'invalid_client', 'Credenciales de cliente inválidas', input.viaBasic); }
    this.failures.delete(clientId);
    const requested = input.scope?.trim() ? [...new Set(input.scope.trim().split(/\s+/))] : client.scopes;
    if (requested.some((scope) => !(DEV_AUTH_SCOPES as readonly string[]).includes(scope) || !client.scopes.includes(scope))) throw new OAuthError(400, 'invalid_scope', 'Scope no permitido para este cliente');
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ scope: requested.join(' '), app_role: 'partner', client_id: client.clientId })
      .setProtectedHeader({ alg: 'RS256', kid: this.jwk.kid, typ: 'JWT' }).setIssuer(this.issuer).setAudience(DEV_AUTH_AUDIENCE).setSubject(client.clientId)
      .setIssuedAt(now).setExpirationTime(now + this.ttlSeconds).setJti(randomUUID()).sign(this.privateKey);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: this.ttlSeconds, scope: requested.join(' ') };
  }

  // Evita una consulta a base por cada petición; desactivar un cliente surte efecto en a lo sumo CLIENT_CACHE_MS.
  private readonly clientCache = new Map<string, { at: number; client: DevAuthClientRecord | null }>();
  private async cachedClient(clientId: string): Promise<DevAuthClientRecord | null> {
    const hit = this.clientCache.get(clientId);
    if (hit && Date.now() - hit.at < CLIENT_CACHE_MS) return hit.client;
    const client = await this.store.find(clientId);
    if (this.clientCache.size > 1000) this.clientCache.clear();
    this.clientCache.set(clientId, { at: Date.now(), client });
    return client;
  }
  /** Descarta la caché de un cliente (lo usan las pruebas y el alta/baja de clientes). */
  invalidateClient(clientId: string): void { this.clientCache.delete(clientId); }

  /** Verifica en proceso (sin autollamada HTTP). Un cliente desactivado deja de valer aunque el token no haya vencido. */
  async verify(token: string): Promise<DevAuthPrincipal | null> {
    if (!this.enabled) return null;
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { issuer: this.issuer, audience: DEV_AUTH_AUDIENCE, algorithms: ['RS256'], clockTolerance: 30 });
      if (typeof payload.sub !== 'string') return null;
      const client = await this.cachedClient(payload.sub);
      if (!client?.active) return null;
      const granted = typeof payload.scope === 'string' ? payload.scope.split(' ').filter((scope) => client.scopes.includes(scope)) : [];
      return { clientId: payload.sub, scopes: new Set(granted) };
    } catch { return null; }
  }
}
