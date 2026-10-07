/* global __dirname */
import 'reflect-metadata';
import { existsSync } from 'node:fs'; import { join } from 'node:path'; import process from 'node:process'; import { PrismaClient } from './infrastructure/persistence/prisma-client/client'; import { createTicketingServer } from './infrastructure/grpc/server';
async function bootstrap(): Promise<void> { const env = join(__dirname, '..', '.env'); if (existsSync(env)) process.loadEnvFile(env); const key = process.env.INTERNAL_API_KEY; if (!key) throw new Error('INTERNAL_API_KEY is required'); const prisma = new PrismaClient(); const app = await createTicketingServer({ url: `0.0.0.0:${process.env.PORT ?? '50055'}`, internalApiKey: key, prisma }); app.enableShutdownHooks(); await app.listen(); process.once('beforeExit', () => void prisma.$disconnect()); }
void bootstrap();
