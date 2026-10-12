/* global __dirname */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createGrpcService } from '@flight-platform/shared';
import { createReservationServer, findProtoRoot } from './infrastructure/grpc/server';
import { CreateReservation } from './application/create-reservation';
import { ReservationQueries } from './application/queries';
import { ResumePending } from './application/resume-pending';
import { FakePaymentVerifier } from './infrastructure/clients/fakes';
import { GrpcAncillariesGateway, GrpcEventPublisher, GrpcInventoryGateway, GrpcPricingGateway, GrpcServiceForOwner, GrpcTicketingGateway } from './infrastructure/clients/grpc-gateways';
import { PrismaClient } from './infrastructure/persistence/prisma-client/client';
import { PrismaReservationStore } from './infrastructure/persistence/prisma-reservation-store';

async function bootstrap(): Promise<void> {
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const root = findProtoRoot();
  const factory = (url: string, packageName: string, proto: string, serviceName: string): GrpcServiceForOwner => (ownerId, role) => createGrpcService({ url, grpcTls: process.env.GRPC_TLS === 'true', internalApiKey, correlationId: `reservation-${Date.now()}`, ownerId, role, packageName, protoPath: join(root, ...proto.split('/')), serviceName });
  const inventory = new GrpcInventoryGateway(factory(process.env.INVENTORY_GRPC_URL ?? 'localhost:50051', 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService'));
  const pricing = new GrpcPricingGateway(factory(process.env.PRICING_GRPC_URL ?? 'localhost:50052', 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
  const ancillaries = new GrpcAncillariesGateway(factory(process.env.ANCILLARIES_GRPC_URL ?? 'localhost:50053', 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
  const ticketing = new GrpcTicketingGateway(factory(process.env.TICKETING_GRPC_URL ?? 'localhost:50055', 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'));
  const events = new GrpcEventPublisher(factory(process.env.WEBHOOKS_GRPC_URL ?? 'localhost:50057', 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService'));
  const prisma = new PrismaClient(); const store = new PrismaReservationStore(prisma); const payment = new FakePaymentVerifier(); const create = new CreateReservation(store, pricing, payment, ancillaries, inventory, ticketing, events); const queries = new ReservationQueries(store, ancillaries, ticketing); const resume = new ResumePending(store, payment, events, ancillaries, inventory, ticketing);
  const app = await createReservationServer({ url: `0.0.0.0:${process.env.PORT ?? '50054'}`, internalApiKey, deps: { createReservation: (input) => create.execute(input as never), getReservation: (input) => queries.get(input as never), listReservations: (input) => queries.list(input as never), getReservationSnapshot: (input) => queries.get(input as never), listReservationsByFlightInstance: (input) => queries.byFlightInstance(input as never), resumePending: (input) => resume.execute(input as never) } });
  app.enableShutdownHooks();
  await app.listen();
}
void bootstrap();
