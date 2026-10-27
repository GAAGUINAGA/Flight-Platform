/* global __dirname */
import { grpcBindUrl } from './bind-host';
import 'reflect-metadata';
import { existsSync } from 'node:fs'; import { join } from 'node:path'; import process from 'node:process'; import { PrismaClient } from './infrastructure/persistence/prisma-client/client'; import { createWebhooksServer } from './infrastructure/grpc/server';
async function bootstrap() { const env = join(__dirname, '..', '.env'); if (existsSync(env)) process.loadEnvFile(env); const key = process.env.INTERNAL_API_KEY; const encryptionKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY; if (!key || !encryptionKey) throw new Error('INTERNAL_API_KEY and WEBHOOK_SECRET_ENCRYPTION_KEY are required'); const prisma = new PrismaClient();  const app = await createWebhooksServer({ url: grpcBindUrl(process.env, '50057'), internalApiKey: key, encryptionKey, prisma }); app.enableShutdownHooks(); await app.listen(); process.once('beforeExit', () => void prisma.$disconnect()); }
void bootstrap();
