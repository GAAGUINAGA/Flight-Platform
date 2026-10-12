/* global __dirname */
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { DynamicModule, INestMicroservice, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { sendUnaryData, Server, ServerUnaryCall, ServiceError } from '@grpc/grpc-js';
import { service as healthService } from 'grpc-health-check';
import pino, { Logger as PinoLogger } from 'pino';
import { buildRequestContext, InternalKeyInterceptor, loggerOptions, safeGrpcError, validate } from '@flight-platform/shared';
import { z } from 'zod';
import { ReservationController, ReservationHandlers, RESERVATION_DEPS } from './reservation.controller';
import { LoggingInterceptor, ReservationExceptionFilter } from './filters';

export const GRPC_PACKAGE = 'flightplatform.reservation.v1';
export const findProtoRoot = (from: string = __dirname): string => { for (let directory = resolve(from); ; directory = dirname(directory)) { const candidate = join(directory, 'contracts', 'proto'); if (existsSync(candidate)) return candidate; if (dirname(directory) === directory) throw new Error('contracts/proto not found'); } };
@Module({}) class ReservationModule { static register(deps: ReservationHandlers): DynamicModule { return { module: ReservationModule, controllers: [ReservationController], providers: [{ provide: RESERVATION_DEPS, useValue: deps }] }; } }
const healthRequest = z.object({ service: z.string().trim().max(255) });
const addHealth = (server: Server, key: string): void => server.addService({ Check: healthService.Check }, { Check: (call: ServerUnaryCall<{ service: string }, { status: string }>, callback: sendUnaryData<{ status: string }>) => { try { buildRequestContext(call.metadata, key); validate(healthRequest, call.request); callback(null, { status: 'SERVING' }); } catch (error) { callback(safeGrpcError(error) as ServiceError); } } });
export const createLogger = (destination?: pino.DestinationStream): PinoLogger => pino({ ...loggerOptions, level: process.env.LOG_LEVEL ?? 'info' }, destination);
export async function createReservationServer(options: { url: string; internalApiKey: string; deps?: ReservationHandlers; logger?: PinoLogger }): Promise<INestMicroservice> {
  if (Buffer.byteLength(options.internalApiKey) < 32) throw new Error('INTERNAL_API_KEY must be at least 32 bytes');
  const root = findProtoRoot(); const app = await NestFactory.createMicroservice<MicroserviceOptions>(ReservationModule.register(options.deps ?? {}), { transport: Transport.GRPC, logger: ['error', 'warn'], options: { url: options.url, package: GRPC_PACKAGE, protoPath: join(root, 'flightplatform/reservation/v1/reservation.proto'), loader: { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true }, onLoadPackageDefinition: (_definition: unknown, server: Server) => addHealth(server, options.internalApiKey) } });
  app.useGlobalInterceptors(new InternalKeyInterceptor(options.internalApiKey), new LoggingInterceptor(options.logger ?? createLogger())); app.useGlobalFilters(new ReservationExceptionFilter()); return app;
}
