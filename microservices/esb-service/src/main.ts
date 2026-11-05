/* global __dirname */
import 'reflect-metadata';
import { join } from 'node:path';
import process from 'node:process';
import { createEsbApp } from './app';
import { loadConfig } from './config';
import { loadEnvFileTolerant } from './load-env';

async function bootstrap(): Promise<void> {
  const { loaded } = loadEnvFileTolerant(join(__dirname, '..', '.env'));
  const config = loadConfig(process.env, { envFileLoaded: loaded });
  const app = await createEsbApp(config);
  app.enableShutdownHooks();
  await app.listen(config.port, config.bindHost);
}
bootstrap().catch((error: unknown) => { process.stderr.write(`esb-service failed to start: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exit(1); });
