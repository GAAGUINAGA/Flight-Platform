import process from 'node:process';
import { expect } from '@jest/globals';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { addGrpcHealthCheck } from '@flight-platform/shared';
import { createDevToken } from '../../../../../infra/scripts/dev-token';
import { loadConfig } from '../../../src/config';
import { createGatewayApp, DEV_AUTH_STORE } from '../../../src/app';
import { DevAuthService, generateClientSecret, hashClientSecret, type DevAuthClientStore } from '../../../src/v2/dev-auth';
import { openApiV2SpecPath } from '../../../src/openapi-path';

export const INTERNAL_KEY = 'gateway-v2-internal-key-for-local-testing';

interface Operation { responses: Record<string, { content?: Record<string, { schema?: object }> }> }
interface Spec { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, object> } }
export const v2Spec = parse(readFileSync(openApiV2SpecPath(), 'utf8')) as Spec;

const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
/** Semántica OpenAPI de las respuestas: una propiedad `writeOnly` no viaja y por tanto tampoco es obligatoria. */
const withoutWriteOnly = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutWriteOnly);
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>; const result: Record<string, unknown> = {};
  const hidden = new Set(Object.entries((record.properties ?? {}) as Record<string, { writeOnly?: boolean }>).filter(([, value]) => value?.writeOnly === true).map(([name]) => name));
  for (const [key, value] of Object.entries(record)) {
    if (key === 'properties') result[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([name]) => !hidden.has(name)).map(([name, inner]) => [name, withoutWriteOnly(inner)]));
    else if (key === 'required' && Array.isArray(value)) result[key] = value.filter((name) => !hidden.has(String(name)));
    else result[key] = withoutWriteOnly(value);
  }
  return result;
};
const responseComponents = withoutWriteOnly(v2Spec.components) as Spec['components'];
const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
const schemaValidator = (key: string, schema: object) => {
  let check = compiled.get(key);
  if (!check) { check = ajv.compile({ ...(key.startsWith('schema:') ? schema : withoutWriteOnly(schema) as object), components: key.startsWith('schema:') ? v2Spec.components : responseComponents }); compiled.set(key, check); }
  return check;
};

/** Valida un esquema nombrado de components.schemas del contrato v2. */
export function expectSchema(name: string, body: unknown): void {
  const check = schemaValidator(`schema:${name}`, v2Spec.components.schemas[name]);
  expect({ valid: check(body), errors: check.errors }).toEqual({ valid: true, errors: null });
}

/**
 * Valida una respuesta contra el contrato v2: el esquema de la operación y el estado exactos si están documentados.
 * Los errores transversales sin esquema propio en la operación (401, 403, 429, 5xx) deben cumplir ProblemDetails.
 */
export function expectV2Response(method: string, template: string, status: number, body: unknown): { documented: boolean } {
  const operation = v2Spec.paths[template]?.[method.toLowerCase()];
  if (!operation) throw new Error(`Operación fuera del contrato v2: ${method} ${template}`);
  const response = operation.responses[String(status)] ?? operation.responses.default;
  const schema = response?.content ? Object.values(response.content)[0]?.schema : undefined;
  if (schema) { const check = schemaValidator(`${method}:${template}:${status}`, schema); expect({ status, valid: check(body), errors: check.errors }).toEqual({ status, valid: true, errors: null }); return { documented: true }; }
  if (response && !response.content) return { documented: true };
  expectSchema('ProblemDetails', body);
  return { documented: false };
}

export interface TestClient { clientId: string; secret: string }
/** Crea un cliente OAuth propio del escenario; el secreto solo vive en memoria durante la prueba. */
export async function registerClient(store: DevAuthClientStore, scopes: string[], clientId = `t-${randomUUID().slice(0, 12)}`): Promise<TestClient> {
  const secret = generateClientSecret();
  await store.create({ clientId, secretHash: await hashClientSecret(secret), scopes, active: true, name: 'test' });
  return { clientId, secret };
}

export const ALL_SCOPES = ['flights:read', 'flights:hold', 'flights:book', 'flights:cancel', 'flights:webhooks', 'flights:ops', 'flights:admin'];

export interface TestGateway {
  app: INestApplication; server: ReturnType<INestApplication['getHttpServer']>; devAuth: DevAuthService; store: DevAuthClientStore;
  devKeyPem: string; customerToken(sub: string, scope: string): string; close(): Promise<void>;
}

/** Gateway de prueba sin base de datos: dev-auth en memoria y una llave de firma conocida para fabricar tokens inválidos. */
export async function startTestGateway(env: Record<string, string | undefined> = {}): Promise<TestGateway> {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  const external = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'gateway-v2-')); const publicKeyFile = join(dir, 'public.pem'); writeFileSync(publicKeyFile, external.publicKey);
  const config = loadConfig({
    NODE_ENV: 'test', INTERNAL_API_KEY: INTERNAL_KEY, VALIDATE_RESPONSES: 'true', SCHEDULER_ENABLED: 'false', PUBLIC_BASE_URL: 'http://gateway.test', DEV_AUTH_PRIVATE_KEY: pair.privateKey,
    JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile }]), ...env
  });
  const app = await createGatewayApp(config);
  await app.listen(0, '127.0.0.1');
  return {
    app, server: app.getHttpServer(), devAuth: app.get(DevAuthService), store: app.get(DEV_AUTH_STORE), devKeyPem: pair.privateKey,
    customerToken: (sub, scope) => createDevToken(external.privateKey, { sub, app_role: 'customer', scope }),
    close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

/** Obtiene un token con `client_credentials` por el endpoint real. */
export async function fetchToken(server: TestGateway['server'], client: TestClient, scope?: string): Promise<string> {
  const response = await request(server).post('/api/v2/oauth2/token').type('form').send({ grant_type: 'client_credentials', client_id: client.clientId, client_secret: client.secret, ...(scope ? { scope } : {}) });
  if (response.status !== 200) throw new Error(`token request failed with ${response.status}`);
  return response.body.access_token as string;
}

/** Siete servidores gRPC con `grpc.health.v1` (sin base de datos) para probar el health agregado. */
export async function startHealthStubs(): Promise<{ servers: Record<string, Server>; restore(): void; stop(name: string): Promise<void> }> {
  const names = ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'];
  const servers: Record<string, Server> = {}; const prior = new Map<string, string | undefined>();
  for (const name of names) {
    const server = new Server(); addGrpcHealthCheck(server);
    const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) => error ? reject(error) : resolve(bound)));
    servers[name] = server; const variable = `${name.toUpperCase()}_GRPC_URL`; prior.set(variable, process.env[variable]); process.env[variable] = `127.0.0.1:${port}`;
  }
  return {
    servers,
    stop: (name) => new Promise((resolve) => servers[name].tryShutdown(() => resolve())),
    restore: () => { for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } for (const server of Object.values(servers)) server.forceShutdown(); }
  };
}
