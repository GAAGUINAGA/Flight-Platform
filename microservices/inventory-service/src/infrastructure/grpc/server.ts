/* global __dirname */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { Module, DynamicModule, INestMicroservice } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { sendUnaryData, Server, ServerUnaryCall, ServiceError } from '@grpc/grpc-js';
import { service as healthService } from 'grpc-health-check';
import pino, { Logger as PinoLogger } from 'pino';
import { PrismaClient } from '@prisma/client';
import {
  buildRequestContext, Clock, InternalKeyInterceptor, loggerOptions, safeGrpcError, SystemClock, validate
} from '@flight-platform/shared';
import { z } from 'zod';
import { FlightAdmin } from '../../application/flight-admin';
import { FlightQueries } from '../../application/flight-queries';
import { HoldUseCases } from '../../application/hold-use-cases';
import { EventPublisher, InventoryConfig } from '../../application/ports';
import { NoopEventPublisher } from '../events/noop-event-publisher';
import { PrismaFlightReader, PrismaUnitOfWork } from '../persistence/prisma-inventory';
import { InventoryExceptionFilter, LoggingInterceptor } from './filters';
import { INVENTORY_DEPS, InventoryController, InventoryDeps } from './inventory.controller';

export const GRPC_PACKAGE = 'flightplatform.inventory.v1';

export function findProtoRoot(from: string = __dirname): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, 'contracts', 'proto');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('contracts/proto not found');
  }
}

export interface InventoryRuntime {
  prisma: PrismaClient;
  clock?: Clock;
  events?: EventPublisher;
  config?: Partial<InventoryConfig>;
}

export function buildDeps(runtime: InventoryRuntime): InventoryDeps {
  const config: InventoryConfig = {
    holdTtlMinutes: runtime.config?.holdTtlMinutes ?? Number(process.env.HOLD_TTL_MINUTES ?? '20'),
    airlineCode: runtime.config?.airlineCode ?? process.env.AIRLINE_CODE ?? 'FP'
  };
  const reader = new PrismaFlightReader(runtime.prisma);
  const uow = new PrismaUnitOfWork(runtime.prisma);
  const events = runtime.events ?? new NoopEventPublisher();
  const clock = runtime.clock ?? new SystemClock();
  return {
    queries: new FlightQueries(reader, uow, events, clock),
    admin: new FlightAdmin(reader, uow),
    holds: new HoldUseCases(uow, events, clock, config),
    config
  };
}

@Module({})
class InventoryModule {
  static register(deps: InventoryDeps): DynamicModule {
    return {
      module: InventoryModule,
      controllers: [InventoryController],
      providers: [{ provide: INVENTORY_DEPS, useValue: deps }]
    };
  }
}

const healthRequest = z.object({ service: z.string().trim().max(255) });

/** Health gRPC est?ndar; como en hello (ADR-0-04) tambi?n exige la llave interna. */
function addHealth(server: Server, internalApiKey: string): void {
  server.addService({ Check: healthService.Check }, {
    Check: (call: ServerUnaryCall<{ service: string }, { status: string }>, callback: sendUnaryData<{ status: string }>) => {
      try {
        buildRequestContext(call.metadata, internalApiKey);
        validate(healthRequest, call.request);
        callback(null, { status: 'SERVING' });
      } catch (error) {
        callback(safeGrpcError(error) as ServiceError);
      }
    }
  });
}

export interface ServerOptions {
  url: string;
  internalApiKey: string;
  runtime: InventoryRuntime;
  logger?: PinoLogger;
}

export function createLogger(destination?: pino.DestinationStream): PinoLogger {
  return pino({ ...loggerOptions, level: process.env.LOG_LEVEL ?? 'info' }, destination);
}

export async function createInventoryServer(opts: ServerOptions): Promise<INestMicroservice> {
  if (Buffer.byteLength(opts.internalApiKey) < 32) throw new Error('INTERNAL_API_KEY must be at least 32 bytes');
  const root = findProtoRoot();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(InventoryModule.register(buildDeps(opts.runtime)), {
    transport: Transport.GRPC,
    logger: ['error', 'warn'],
    options: {
      url: opts.url,
      package: GRPC_PACKAGE,
      protoPath: join(root, 'flightplatform/inventory/v1/inventory.proto'),
      loader: { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true },
      onLoadPackageDefinition: (_pkg: unknown, server: Server) => addHealth(server, opts.internalApiKey)
    }
  });
  app.useGlobalInterceptors(new InternalKeyInterceptor(opts.internalApiKey), new LoggingInterceptor(opts.logger ?? createLogger()));
  app.useGlobalFilters(new InventoryExceptionFilter());
  return app;
}
