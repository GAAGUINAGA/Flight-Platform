/* global __dirname */
import { existsSync } from 'node:fs'; import { dirname, join, resolve } from 'node:path'; import process from 'node:process';
import { Buffer } from 'node:buffer'; import { DynamicModule, INestMicroservice, Module } from '@nestjs/common'; import { NestFactory } from '@nestjs/core'; import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { sendUnaryData, Server, ServerUnaryCall } from '@grpc/grpc-js'; import { service as healthService } from 'grpc-health-check'; import { PrismaClient } from '../persistence/prisma-client/client';
import { buildRequestContext, InternalKeyInterceptor, loggerOptions, safeGrpcError, validate } from '@flight-platform/shared'; import { z } from 'zod'; import pino, { Logger as PinoLogger } from 'pino';
import { TicketStore } from '../../application/ports'; import { TicketUseCases } from '../../application/ticket-use-cases'; import { PrismaTicketStore } from '../persistence/prisma-ticket-store'; import { TicketingExceptionFilter, TicketingLoggingInterceptor } from './filters'; import { TICKETING_DEPS, TicketingController } from './ticketing.controller';
export const GRPC_PACKAGE = 'flightplatform.ticketing.v1';
export const findProtoRoot = (from: string = __dirname): string => { for (let d = resolve(from); ; d = dirname(d)) { const p = join(d, 'contracts', 'proto'); if (existsSync(p)) return p; if (dirname(d) === d) throw new Error('contracts/proto not found'); } };
@Module({}) class TicketingModule { static register(useCases: TicketUseCases): DynamicModule { return { module: TicketingModule, controllers: [TicketingController], providers: [{ provide: TICKETING_DEPS, useValue: useCases }] }; } }
const health = z.object({ service: z.string().max(255) });
const addHealth = (server: Server, key: string) => server.addService({ Check: healthService.Check }, { Check: (call: ServerUnaryCall<{service:string}, {status:string}>, cb: sendUnaryData<{status:string}>) => { try { buildRequestContext(call.metadata, key); validate(health, call.request); cb(null, { status: 'SERVING' }); } catch (e) { cb(safeGrpcError(e)); } } });
export function createLogger(destination?: pino.DestinationStream): PinoLogger { return pino({ ...loggerOptions, level: process.env.LOG_LEVEL ?? 'info', redact: { paths: [...loggerOptions.redact.paths, 'request.passengers.*.firstName', 'request.passengers.*.lastName', 'request.passengers.*.documentNumber', 'request.passengers.*.contact.email', 'request.passengers.*.contact.phone'], censor: '[REDACTED]' } }, destination); }
type FailMode = 'none' | 'always' | 'first_attempt';
/** Valores que dejan el control de prueba apagado. `none` es el valor documentado en el PLAN §8. */
const inactiveFailModes = new Set(['', 'off', 'none']);
/**
 * TICKETING_FAIL_MODE es un control de prueba: con NODE_ENV=production el servicio se niega a arrancar si está activo,
 * en lugar de ignorarlo. El mensaje no incluye el valor.
 */
export function resolveFailMode(env: Record<string, string | undefined> = process.env): FailMode {
  const raw = (env.TICKETING_FAIL_MODE ?? '').trim();
  const active = !inactiveFailModes.has(raw.toLowerCase());
  if (env.NODE_ENV === 'production' && active) throw new Error('TICKETING_FAIL_MODE is a test control and must not be set when NODE_ENV=production; unset it and restart');
  return raw === 'always' || raw === 'first_attempt' ? raw : 'none';
}
export async function createTicketingServer(options: { url: string; internalApiKey: string; prisma: PrismaClient; store?: TicketStore; logger?: PinoLogger; config?: Partial<{ prefix: string; failMode: 'none'|'always'|'first_attempt' }> }): Promise<INestMicroservice> {
  if (Buffer.byteLength(options.internalApiKey) < 32) throw new Error('INTERNAL_API_KEY must be at least 32 bytes');
  const envFailMode = resolveFailMode();
  const useCases = new TicketUseCases(options.store ?? new PrismaTicketStore(options.prisma), { prefix: options.config?.prefix ?? process.env.ETICKET_PREFIX ?? '999', failMode: options.config?.failMode ?? envFailMode });
  const root = findProtoRoot(); const app = await NestFactory.createMicroservice<MicroserviceOptions>(TicketingModule.register(useCases), { transport: Transport.GRPC, logger: ['error','warn'], options: { url: options.url, package: GRPC_PACKAGE, protoPath: join(root, 'flightplatform/ticketing/v1/ticketing.proto'), loader: { includeDirs:[root], keepCase:false, enums:String, longs:Number, defaults:true, arrays:true, objects:true }, onLoadPackageDefinition: (_: unknown, server: Server) => addHealth(server, options.internalApiKey) } });
  app.useGlobalInterceptors(new InternalKeyInterceptor(options.internalApiKey), new TicketingLoggingInterceptor(options.logger ?? createLogger())); app.useGlobalFilters(new TicketingExceptionFilter()); return app;
}
