/* global __dirname */
import { grpcBindUrl } from './bind-host';
import 'reflect-metadata';
import { existsSync } from 'node:fs'; import { join } from 'node:path'; import process from 'node:process'; import { PrismaClient } from './infrastructure/persistence/prisma-client/client'; import { createTicketingServer } from './infrastructure/grpc/server';
async function bootstrap(): Promise<void> { const env = join(__dirname, '..', '.env'); if (existsSync(env)) process.loadEnvFile(env); const key = process.env.INTERNAL_API_KEY; if (!key) throw new Error('INTERNAL_API_KEY is required'); const prisma = new PrismaClient(); const app = await createTicketingServer({ url: grpcBindUrl(process.env, '50055'), internalApiKey: key, prisma }); app.enableShutdownHooks(); await app.listen(); process.once('beforeExit', () => void prisma.$disconnect()); }
bootstrap().catch((error: unknown) => { process.stderr.write(`ticketing-service failed to start: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exit(1); });
