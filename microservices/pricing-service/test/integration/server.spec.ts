import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { credentials, makeClientConstructor, Metadata } from '@grpc/grpc-js';
import { service as healthService } from 'grpc-health-check';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { INestMicroservice } from '@nestjs/common';
import { createPricingServer } from '../../src/infrastructure/grpc/server';

const INTERNAL_KEY = 'p'.repeat(40);
type HealthClient = { check(request: { service: string }, metadata: Metadata, callback: (error: { code: number } | null, response?: { status: string }) => void): void; close(): void };

describe('PRC-01: servidor Pricing gRPC', () => {
  let app: INestMicroservice | undefined;
  let client: HealthClient | undefined;

  beforeAll(async () => {
    const port = 25000 + Math.floor(Math.random() * 10000);
    app = await createPricingServer({
      url: `127.0.0.1:${port}`,
      internalApiKey: INTERNAL_KEY,
      runtime: { prisma: new PrismaClient() }
    });
    await app.listen();
    const HealthClientConstructor = makeClientConstructor(healthService, 'grpc.health.v1.Health');
    client = new HealthClientConstructor(`127.0.0.1:${port}`, credentials.createInsecure()) as unknown as HealthClient;
  });

  afterAll(async () => {
    try { client?.close(); } finally { await app?.close(); }
  });

  it('PRC-01: health responde SERVING con llave interna', async () => {
    const metadata = new Metadata();
    metadata.set('x-internal-key', INTERNAL_KEY);
    await expect(new Promise<{ status: string }>((resolve, reject) =>
      client?.check({ service: '' }, metadata, (error, response) => error ? reject(error) : resolve(response as { status: string }))
    )).resolves.toEqual({ status: 'SERVING' });
  });

  it('PRC-01: health rechaza llamadas sin llave interna', async () => {
    await expect(new Promise((resolve, reject) =>
      client?.check({ service: '' }, new Metadata(), (error, response) => error ? reject(error) : resolve(response))
    )).rejects.toMatchObject({ code: 16 });
  });
});
