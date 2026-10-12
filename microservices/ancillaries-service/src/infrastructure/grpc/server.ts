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
import { AncillariesController, AncillariesDeps, ANCILLARIES_DEPS } from './ancillaries.controller';
import { AncillariesExceptionFilter, LoggingInterceptor } from './filters';
import { PrismaClient } from '../persistence/prisma-client/client';
import { PricingGateway } from '../../application/ports';
import { GetSeatMapForOffer } from '../../application/seat-map';
import { SeatAssignments } from '../../application/seat-assignments';
import { PrismaSeatMapStore } from '../persistence/prisma-seat-map';
import { PrismaSeatAssignmentStore } from '../persistence/prisma-seat-assignments';
import { FakePricingGateway } from '../clients/fakes';
import { Baggage } from '../../application/baggage';
import { PrismaBaggageStore } from '../persistence/prisma-baggage';
import { PrismaBookingOwnershipStore } from '../persistence/prisma-booking-ownership';

export const GRPC_PACKAGE = 'flightplatform.ancillaries.v1';
export const findProtoRoot = (from: string = __dirname): string => {
  for (let directory = resolve(from); ; directory = dirname(directory)) {
    const candidate = join(directory, 'contracts', 'proto');
    if (existsSync(candidate)) return candidate;
    if (dirname(directory) === directory) throw new Error('contracts/proto not found');
  }
};

@Module({})
class AncillariesModule {
  static register(deps: AncillariesDeps): DynamicModule {
    return { module: AncillariesModule, controllers: [AncillariesController], providers: [{ provide: ANCILLARIES_DEPS, useValue: deps }] };
  }
}

const healthRequest = z.object({ service: z.string().trim().max(255) });
const addHealth = (server: Server, key: string): void => {
  server.addService({ Check: healthService.Check }, { Check: (call: ServerUnaryCall<{ service: string }, { status: string }>, callback: sendUnaryData<{ status: string }>) => {
    try { buildRequestContext(call.metadata, key); validate(healthRequest, call.request); callback(null, { status: 'SERVING' }); }
    catch (error) { callback(safeGrpcError(error) as ServiceError); }
  } });
};

export const createLogger = (destination?: pino.DestinationStream): PinoLogger => pino({ ...loggerOptions, level: process.env.LOG_LEVEL ?? 'info' }, destination);
export interface AncillariesRuntime { prisma: PrismaClient; pricing?: PricingGateway; }
const buildDeps = (runtime?: AncillariesRuntime, supplied?: AncillariesDeps): AncillariesDeps => {
  if (supplied) return supplied;
  if (!runtime) return {};
  const pricing = runtime.pricing ?? new FakePricingGateway();
  const layouts = new PrismaSeatMapStore(runtime.prisma);
  const ownership = new PrismaBookingOwnershipStore(runtime.prisma);
  return { seatMap: new GetSeatMapForOffer(pricing, layouts, layouts), seats: new SeatAssignments(pricing, layouts, new PrismaSeatAssignmentStore(runtime.prisma), ownership), baggage: new Baggage(new PrismaBaggageStore(runtime.prisma), Number(process.env.BAGGAGE_MAX_ALLOWED ?? '3'), ownership) };
};
export async function createAncillariesServer(options: { url: string; internalApiKey: string; runtime?: AncillariesRuntime; deps?: AncillariesDeps; logger?: PinoLogger }): Promise<INestMicroservice> {
  if (Buffer.byteLength(options.internalApiKey) < 32) throw new Error('INTERNAL_API_KEY must be at least 32 bytes');
  const root = findProtoRoot();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AncillariesModule.register(buildDeps(options.runtime, options.deps)), {
    transport: Transport.GRPC,
    logger: ['error', 'warn'],
    options: { url: options.url, package: GRPC_PACKAGE, protoPath: join(root, 'flightplatform/ancillaries/v1/ancillaries.proto'), loader: { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true }, onLoadPackageDefinition: (_definition: unknown, server: Server) => addHealth(server, options.internalApiKey) }
  });
  app.useGlobalInterceptors(new InternalKeyInterceptor(options.internalApiKey), new LoggingInterceptor(options.logger ?? createLogger()));
  app.useGlobalFilters(new AncillariesExceptionFilter());
  return app;
}
