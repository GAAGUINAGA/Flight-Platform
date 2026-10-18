import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { afterAll, beforeAll } from '@jest/globals';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { createGrpcService } from '@flight-platform/shared';
import { PricingGrpcService } from '../../src/application/ports';
import { GrpcPricingGateway } from '../../src/infrastructure/clients/grpc-gateways';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaBaggageStore } from '../../src/infrastructure/persistence/prisma-baggage';
import { createAncillariesServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const key = 'p'.repeat(40);
const owner = 'pool-pressure-test-owner';
const bookingId = randomUUID();
const otherBookingId = randomUUID();
const passengerId = randomUUID();
const itineraryId = randomUUID();
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void> & { close(): void };

describe('F9 / integración con pool limitado', () => {
  let prisma: PrismaClient;
  let app: INestMicroservice;
  let client: Client;
  let pauseOwnership = false;
  let ownerRead!: () => void;
  let releaseOwnerRead!: () => void;
  let continueOwnerRead: Promise<void>;
  const call = <T>(method: string, request: unknown): Promise<T> => new Promise((resolve, reject) => {
    const metadata = new Metadata();
    metadata.set('x-internal-key', key);
    metadata.set('x-owner-id', owner);
    metadata.set('x-role', 'system');
    client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T));
  });
  beforeAll(async () => {
    const envPath = join(process.cwd(), 'microservices', 'ancillaries-service', '.env');
    if (!process.env.DATABASE_URL && existsSync(envPath)) process.loadEnvFile(envPath);
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Ancillaries integration tests');
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('pool_timeout', '10');
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await prisma.$connect();
    const instrumented = prisma.$extends({ query: { $allOperations: async ({ operation, args, query }) => {
      const result = await query(args);
      if (pauseOwnership && operation === '$queryRaw') { pauseOwnership = false; ownerRead(); await continueOwnerRead; }
      return result;
    } } }) as unknown as PrismaClient;
    const port = 39000 + Math.floor(Math.random() * 1000);
    const root = findProtoRoot();
    const pricing = new GrpcPricingGateway(createGrpcService<PricingGrpcService>({ url: '127.0.0.1:1', grpcTls: false, internalApiKey: key, correlationId: 'pool-pressure', role: 'system', packageName: 'flightplatform.pricing.v1', protoPath: join(root, 'flightplatform/pricing/v1/pricing.proto'), serviceName: 'PricingService' }));
    app = await createAncillariesServer({ url: `127.0.0.1:${port}`, internalApiKey: key, runtime: { prisma: instrumented, pricing } });
    await app.listen();
    const definition = loadSync(join(root, 'flightplatform/ancillaries/v1/ancillaries.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { ancillaries: { v1: { AncillariesService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.ancillaries.v1.AncillariesService(`127.0.0.1:${port}`, credentials.createInsecure());
    for (const booking of [bookingId, otherBookingId]) await call('registerBaggageAllowance', { bookingId: booking, allowances: [{ passengerId, itineraryId, checkedBaggageIncluded: 0 }] });
  });
  afterAll(async () => {
    try { client?.close(); await app?.close(); }
    finally {
      try {
        if (prisma) {
          await prisma.baggageItem.deleteMany({ where: { bookingId: { in: [bookingId, otherBookingId] } } });
          await prisma.baggageAllowance.deleteMany({ where: { bookingId: { in: [bookingId, otherBookingId] } } });
          await prisma.bookingOwner.deleteMany({ where: { bookingId: { in: [bookingId, otherBookingId] } } });
        }
      } finally { await prisma?.$disconnect(); }
    }
  });
  it('F9 / C: lecturas, compra y liberación con una conexión ocupada temporalmente', async () => {
    const ownershipRead = new Promise<void>((resolve) => { ownerRead = resolve; });
    continueOwnerRead = new Promise<void>((resolve) => { releaseOwnerRead = resolve; });
    pauseOwnership = true;
    const grpcPurchase = call('purchaseBaggage', { bookingId, passengerId, itineraryId, quantity: 1, operationId: randomUUID() });
    await ownershipRead;
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const occupied = prisma.$transaction(async (tx) => { ready(); await tx.$executeRaw`SELECT pg_sleep(2.5)`; });
    await started;
    releaseOwnerRead();
    const store = new PrismaBaggageStore(prisma);
    const waitingPurchase = store.purchase({ bookingId: otherBookingId, ownerId: owner, passengerId, itineraryId, quantity: 1, status: 'CONFIRMED' }, 3);
    const results = await Promise.allSettled([
      occupied,
      waitingPurchase,
      call('getAssignments', { bookingId }),
      call('getBaggageOptions', { bookingId }),
      grpcPurchase,
      call('releaseAll', { bookingId })
    ]);
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => ({ code: result.reason?.code, details: result.reason?.details }));
    expect(errors).toEqual([]);
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: { assignments: [] } });
    expect(results[3]).toMatchObject({ status: 'fulfilled', value: { options: [expect.objectContaining({ passengerId, itineraryId })] } });
    expect(results[4]).toMatchObject({ status: 'fulfilled', value: { passengerId, itineraryId, totalBaggage: 1 } });
    expect(await prisma.baggageItem.count({ where: { bookingId: otherBookingId, ownerId: owner, status: 'CONFIRMED' } })).toBe(1);
  }, 20000);
});
