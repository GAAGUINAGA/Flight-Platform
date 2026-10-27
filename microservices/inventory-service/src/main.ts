/* global __dirname */
import { grpcBindUrl } from './bind-host';
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { createInventoryServer, createLogger, findProtoRoot } from './infrastructure/grpc/server';
import { createGrpcClient, withGrpcCallContext } from '@flight-platform/shared';
import { GrpcEventPublisher, SafeEventPublisher } from './infrastructure/events/grpc-event-publisher';

async function bootstrap(): Promise<void> {
  // Desarrollo local: carga .env del servicio; en Cloud Run las variables vienen del entorno.
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const prisma = new PrismaClient();
  const root = findProtoRoot(); const webhookOptions = { url: process.env.WEBHOOKS_GRPC_URL ?? 'localhost:50057', grpcTls: process.env.GRPC_TLS === 'true', internalApiKey, correlationId: 'inventory-service', role: 'system', packageName: 'flightplatform.webhooks.v1', protoPath: join(root, 'flightplatform', 'webhooks', 'v1', 'webhooks.proto'), serviceName: 'WebhooksService' };
  const webhookClient = createGrpcClient(webhookOptions); const logger = createLogger(); const events = new SafeEventPublisher(new GrpcEventPublisher(withGrpcCallContext(webhookClient.getService(webhookOptions.serviceName), webhookOptions)), logger);
  const app = await createInventoryServer({
    url: grpcBindUrl(process.env, '50051'),
    internalApiKey,
    runtime: { prisma, events }, logger
  });
  app.enableShutdownHooks();
  await app.listen();
  process.once('beforeExit', () => { (webhookClient as unknown as { close(): void }).close(); void prisma.$disconnect(); });
}

void bootstrap();
