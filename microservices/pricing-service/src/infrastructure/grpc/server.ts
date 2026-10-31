/* global __dirname */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { DynamicModule, INestMicroservice, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { sendUnaryData, Server, ServerUnaryCall, ServiceError } from '@grpc/grpc-js';
import { service as healthService } from 'grpc-health-check';
import pino, { Logger as PinoLogger } from 'pino';
import { PrismaClient } from '../persistence/prisma-client/client';
import { buildRequestContext, Clock, InternalKeyInterceptor, loggerOptions, safeGrpcError, SystemClock, validate } from '@flight-platform/shared';
import { z } from 'zod';
import { InventoryGateway } from '../../application/ports';
import { SearchOffers } from '../../application/search-offers';
import { OfferHolds } from '../../application/offer-holds';
import { PostSalePricing } from '../../application/post-sale-pricing';
import { FakeInventoryGateway } from '../inventory/fake-inventory.gateway';
import { PrismaOfferStore } from '../persistence/prisma-offers';
import { LoggingInterceptor, PricingExceptionFilter } from './filters';
import { PRICING_DEPS, PricingController, PricingDeps } from './pricing.controller';
import { FareAdmin } from '../../application/fare-admin';

export const GRPC_PACKAGE = 'flightplatform.pricing.v1';

export function findProtoRoot(from: string = __dirname): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, 'contracts', 'proto');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('contracts/proto not found');
  }
}

export interface PricingConfig {
  holdTtlMinutes: number;
  offerTtlMinutes: number;
  changeOfferTtlMinutes: number;
  minConnectionMinutes: number;
  maxStops: number;
  changeFeeMinor: number;
  cancelPenaltyMinor: number;
  currency: string;
  airlineCode: string;
  airlineName: string;
  maxOffers: number;
  maxCandidatesPerLeg?: number;
}
export interface PricingRuntime { prisma: PrismaClient; clock?: Clock; inventory?: InventoryGateway; config?: Partial<PricingConfig> }

export function buildDeps(runtime: PricingRuntime): PricingDeps {
  const clock = runtime.clock ?? new SystemClock();
  const inventory = runtime.inventory ?? new FakeInventoryGateway();
  const config: PricingConfig = {
    holdTtlMinutes: runtime.config?.holdTtlMinutes ?? Number(process.env.HOLD_TTL_MINUTES ?? '20'),
    offerTtlMinutes: runtime.config?.offerTtlMinutes ?? Number(process.env.OFFER_TTL_MINUTES ?? '15'),
    changeOfferTtlMinutes: runtime.config?.changeOfferTtlMinutes ?? Number(process.env.CHANGE_OFFER_TTL_MINUTES ?? '15'),
    minConnectionMinutes: runtime.config?.minConnectionMinutes ?? Number(process.env.MIN_CONNECTION_MINUTES ?? '60'),
    maxStops: runtime.config?.maxStops ?? Number(process.env.MAX_STOPS ?? '1'),
    changeFeeMinor: runtime.config?.changeFeeMinor ?? Number(process.env.CHANGE_FEE_MINOR ?? '5000'),
    cancelPenaltyMinor: runtime.config?.cancelPenaltyMinor ?? Number(process.env.CANCEL_PENALTY_MINOR ?? '0'),
    currency: runtime.config?.currency ?? process.env.CURRENCY ?? 'USD',
    airlineCode: runtime.config?.airlineCode ?? process.env.AIRLINE_CODE ?? 'FP',
    airlineName: runtime.config?.airlineName ?? process.env.AIRLINE_NAME ?? 'Flight Platform',
    maxOffers: runtime.config?.maxOffers ?? Number(process.env.SEARCH_MAX_OFFERS ?? '10'),
    maxCandidatesPerLeg: runtime.config?.maxCandidatesPerLeg ?? Number(process.env.SEARCH_MAX_CANDIDATES_PER_LEG ?? '100')
  };
  const store = new PrismaOfferStore(runtime.prisma);
  return { currency: config.currency, search: new SearchOffers(inventory, store, clock, config), holds: new OfferHolds(inventory, store, clock, config), postSale: new PostSalePricing(store, inventory, clock, config), fares: new FareAdmin(store) };
}

@Module({})
class PricingModule {
  static register(deps: PricingDeps): DynamicModule {
    return { module: PricingModule, controllers: [PricingController], providers: [{ provide: PRICING_DEPS, useValue: deps }] };
  }
}

const healthRequest = z.object({ service: z.string().trim().max(255) });
function addHealth(server: Server, internalApiKey: string): void {
  server.addService({ Check: healthService.Check }, {
    Check: (call: ServerUnaryCall<{ service: string }, { status: string }>, callback: sendUnaryData<{ status: string }>) => {
      try {
        buildRequestContext(call.metadata, internalApiKey);
        validate(healthRequest, call.request);
        callback(null, { status: 'SERVING' });
      } catch (error) { callback(safeGrpcError(error) as ServiceError); }
    }
  });
}

export interface ServerOptions { url: string; internalApiKey: string; runtime: PricingRuntime; logger?: PinoLogger }
export function createLogger(destination?: pino.DestinationStream): PinoLogger {
  return pino({ ...loggerOptions, level: process.env.LOG_LEVEL ?? 'info' }, destination);
}

export async function createPricingServer(opts: ServerOptions): Promise<INestMicroservice> {
  if (Buffer.byteLength(opts.internalApiKey) < 32) throw new Error('INTERNAL_API_KEY must be at least 32 bytes');
  const root = findProtoRoot();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(PricingModule.register(buildDeps(opts.runtime)), {
    transport: Transport.GRPC,
    logger: ['error', 'warn'],
    options: {
      url: opts.url, package: GRPC_PACKAGE, protoPath: join(root, 'flightplatform/pricing/v1/pricing.proto'),
      loader: { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true },
      onLoadPackageDefinition: (_pkg: unknown, server: Server) => addHealth(server, opts.internalApiKey)
    }
  });
  app.useGlobalInterceptors(new InternalKeyInterceptor(opts.internalApiKey), new LoggingInterceptor(opts.logger ?? createLogger()));
  app.useGlobalFilters(new PricingExceptionFilter());
  return app;
}
