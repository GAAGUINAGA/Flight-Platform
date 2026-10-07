/* global __dirname */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { createInventoryServer } from './infrastructure/grpc/server';

async function bootstrap(): Promise<void> {
  // Desarrollo local: carga .env del servicio; en Cloud Run las variables vienen del entorno.
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const prisma = new PrismaClient();
  const app = await createInventoryServer({
    url: `0.0.0.0:${process.env.PORT ?? '50051'}`,
    internalApiKey,
    runtime: { prisma }
  });
  app.enableShutdownHooks();
  await app.listen();
  process.once('beforeExit', () => void prisma.$disconnect());
}

void bootstrap();
