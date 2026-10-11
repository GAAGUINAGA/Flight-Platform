import 'reflect-metadata';
import { join } from 'node:path';
import process from 'node:process';
import { createGrpcService } from '@flight-platform/shared';
import { PrismaClient } from './infrastructure/persistence/prisma-client/client';
import { GrpcEventPublisher, GrpcInventoryGateway } from './infrastructure/adapters/grpc-adapters';
import { findProtoRoot, createOperationsServer } from './infrastructure/grpc/server';

async function bootstrap() {
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const root = findProtoRoot();
  const clientOptions = { grpcTls: process.env.GRPC_TLS === 'true', internalApiKey, correlationId: 'operations-service', role: 'admin' };
  const inventory = new GrpcInventoryGateway(createGrpcService({
    ...clientOptions, url: process.env.INVENTORY_GRPC_URL ?? 'localhost:50051', packageName: 'flightplatform.inventory.v1',
    protoPath: join(root, 'flightplatform', 'inventory', 'v1', 'inventory.proto'), serviceName: 'InventoryService'
  }));
  const events = new GrpcEventPublisher(createGrpcService({
    ...clientOptions, url: process.env.WEBHOOKS_GRPC_URL ?? 'localhost:50057', packageName: 'flightplatform.webhooks.v1',
    protoPath: join(root, 'flightplatform', 'webhooks', 'v1', 'webhooks.proto'), serviceName: 'WebhooksService'
  }));
  const prisma = new PrismaClient();
  const app = await createOperationsServer({ url: `0.0.0.0:${process.env.PORT ?? '50056'}`, internalApiKey, runtime: { prisma, inventory, events } });
  app.enableShutdownHooks();
  await app.listen();
  process.once('beforeExit', () => void prisma.$disconnect());
}

void bootstrap();
