import 'reflect-metadata';
import process from 'node:process';
import { join } from 'node:path';
import { createGrpcService } from '@flight-platform/shared';
import { PrismaClient } from './infrastructure/persistence/prisma-client/client';
import { createPricingServer, findProtoRoot } from './infrastructure/grpc/server';
import { GrpcInventoryGateway } from './infrastructure/inventory/grpc-inventory.gateway';
import { InventoryGrpcService } from './application/ports';

async function bootstrap(): Promise<void> {
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const prisma = new PrismaClient();
  const inventoryUrl = process.env.INVENTORY_GRPC_URL;
  const inventory = inventoryUrl ? new GrpcInventoryGateway(createGrpcService<InventoryGrpcService>({
    url: inventoryUrl,
    grpcTls: process.env.GRPC_TLS === 'true',
    internalApiKey,
    correlationId: 'pricing-service',
    role: 'customer',
    packageName: 'flightplatform.inventory.v1',
    protoPath: join(findProtoRoot(), 'flightplatform', 'inventory', 'v1', 'inventory.proto'),
    serviceName: 'InventoryService'
  })) : undefined;
  const app = await createPricingServer({
    url: `0.0.0.0:${process.env.PORT ?? '50052'}`,
    internalApiKey,
    runtime: { prisma, inventory }
  });
  app.enableShutdownHooks();
  await app.listen();
  process.once('beforeExit', () => void prisma.$disconnect());
}

void bootstrap();
