import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { GRPC_HEALTH_PROTO_PATH } from '@flight-platform/shared';
import { createReservationServer, findProtoRoot } from '../src/infrastructure/grpc/server';

const key = 'a'.repeat(40);
type HealthClient = { check(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: { status: string }) => void): void; close(): void };
describe('RSV-01: servidor Reservation', () => {
  let app: INestMicroservice; let client: HealthClient;
  const call = (internalKey?: string) => new Promise<{ status: string }>((resolve, reject) => { const metadata = new Metadata(); if (internalKey !== undefined) metadata.set('x-internal-key', internalKey); client.check({ service: '' }, metadata, (error, response) => error ? reject(error) : resolve(response)); });
  beforeAll(async () => { const port = 36000 + Math.floor(Math.random() * 1000); app = await createReservationServer({ url: `127.0.0.1:${port}`, internalApiKey: key }); await app.listen(); const definition = loadSync(GRPC_HEALTH_PROTO_PATH, { includeDirs: [findProtoRoot()], keepCase: false, enums: String, defaults: true }); const pkg = loadPackageDefinition(definition) as unknown as { grpc: { health: { v1: { Health: new (address: string, credentials: unknown) => HealthClient } } } }; client = new pkg.grpc.health.v1.Health(`127.0.0.1:${port}`, credentials.createInsecure()); });
  afterAll(async () => { try { client?.close(); } finally { await app?.close(); } });
  it('RSV-01 / M: health responde SERVING con llave interna', async () => { await expect(call(key)).resolves.toEqual({ status: 'SERVING' }); });
  it('RSV-SEC-04 / S: health rechaza una llave ausente', async () => { await expect(call()).rejects.toMatchObject({ code: 16, details: 'UNAUTHENTICATED' }); });
});
