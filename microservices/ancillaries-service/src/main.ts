/* global __dirname */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { join } from 'node:path';
import { createGrpcService } from '@flight-platform/shared';
import { PricingGrpcService } from './application/ports';
import { GrpcPricingGateway } from './infrastructure/clients/grpc-gateways';
import { PrismaClient } from './infrastructure/persistence/prisma-client/client';
import { createAncillariesServer, findProtoRoot } from './infrastructure/grpc/server';

async function bootstrap(): Promise<void> {
  // Desarrollo local: carga .env del servicio; en Cloud Run las variables vienen del entorno.
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const root = findProtoRoot();
  const pricing = new GrpcPricingGateway(createGrpcService<PricingGrpcService>({ url: process.env.PRICING_GRPC_URL ?? 'localhost:50052', grpcTls: process.env.GRPC_TLS === 'true', internalApiKey, correlationId: 'ancillaries-service', role: 'system', packageName: 'flightplatform.pricing.v1', protoPath: join(root, 'flightplatform', 'pricing', 'v1', 'pricing.proto'), serviceName: 'PricingService' }));
  const prisma = new PrismaClient();
  const app = await createAncillariesServer({ url: `0.0.0.0:${process.env.PORT ?? '50053'}`, internalApiKey, runtime: { prisma, pricing } });
  app.enableShutdownHooks();
  await app.listen();
  process.once('beforeExit', () => void prisma.$disconnect());
}

void bootstrap();
