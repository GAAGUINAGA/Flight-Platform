/* global require, module */
import { grpcBindUrl } from './bind-host';
import 'reflect-metadata';
import { join } from 'node:path';
import process from 'node:process';
import { createGrpcClient, withGrpcCallContext } from '@flight-platform/shared';
import { PrismaClient } from './infrastructure/persistence/prisma-client/client';
import { GrpcEventPublisher, GrpcInventoryGateway, GrpcReservationGateway } from './infrastructure/adapters/grpc-adapters';
import { GrpcCheckInReservation, GrpcCheckInSeats, GrpcCheckInTicketing } from './infrastructure/adapters/check-in-grpc';
import { findProtoRoot, createOperationsServer } from './infrastructure/grpc/server';

export function createOperationsRuntime(internalApiKey: string, prisma: PrismaClient) {
  const root = findProtoRoot();
  const clientOptions = { grpcTls: process.env.GRPC_TLS === 'true', internalApiKey, correlationId: 'operations-service', role: 'admin' };
  const inventoryOptions = {
    ...clientOptions, url: process.env.INVENTORY_GRPC_URL ?? 'localhost:50051', packageName: 'flightplatform.inventory.v1',
    protoPath: join(root, 'flightplatform', 'inventory', 'v1', 'inventory.proto'), serviceName: 'InventoryService'
  };
  const eventsOptions = {
    ...clientOptions, url: process.env.WEBHOOKS_GRPC_URL ?? 'localhost:50057', packageName: 'flightplatform.webhooks.v1',
    protoPath: join(root, 'flightplatform', 'webhooks', 'v1', 'webhooks.proto'), serviceName: 'WebhooksService'
  };
  const reservationOptions = { ...clientOptions, url: process.env.RESERVATION_GRPC_URL ?? 'localhost:50054', packageName: 'flightplatform.reservation.v1', protoPath: join(root, 'flightplatform', 'reservation', 'v1', 'reservation.proto'), serviceName: 'ReservationService' };
  const ticketingOptions = { ...clientOptions, url: process.env.TICKETING_GRPC_URL ?? 'localhost:50055', packageName: 'flightplatform.ticketing.v1', protoPath: join(root, 'flightplatform', 'ticketing', 'v1', 'ticketing.proto'), serviceName: 'TicketingService' };
  const seatsOptions = { ...clientOptions, url: process.env.ANCILLARIES_GRPC_URL ?? 'localhost:50053', packageName: 'flightplatform.ancillaries.v1', protoPath: join(root, 'flightplatform', 'ancillaries', 'v1', 'ancillaries.proto'), serviceName: 'AncillariesService' };
  const inventoryClient = createGrpcClient(inventoryOptions);
  const eventsClient = createGrpcClient(eventsOptions);
  const reservationClient = createGrpcClient(reservationOptions);
  const ticketingClient = createGrpcClient(ticketingOptions);
  const seatsClient = createGrpcClient(seatsOptions);
  const inventory = new GrpcInventoryGateway(withGrpcCallContext(inventoryClient.getService(inventoryOptions.serviceName), inventoryOptions));
  const events = new GrpcEventPublisher(withGrpcCallContext(eventsClient.getService(eventsOptions.serviceName), eventsOptions));
  const reservations = new GrpcReservationGateway(withGrpcCallContext(reservationClient.getService(reservationOptions.serviceName), { ...reservationOptions, role: 'system' }));
  const checkInReservation = new GrpcCheckInReservation(reservationClient.getService(reservationOptions.serviceName), reservationOptions);
  const checkInTicketing = new GrpcCheckInTicketing(ticketingClient.getService(ticketingOptions.serviceName), ticketingOptions);
  const checkInSeats = new GrpcCheckInSeats(seatsClient.getService(seatsOptions.serviceName), seatsOptions);
  return { runtime: { prisma, inventory, reservations, events, checkInReservation, checkInTicketing, checkInSeats }, close: () => { for (const client of [inventoryClient, eventsClient, reservationClient, ticketingClient, seatsClient]) (client as unknown as { close(): void }).close(); } };
}

async function bootstrap() {
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const prisma = new PrismaClient();
  const composition = createOperationsRuntime(internalApiKey, prisma);
  const app = await createOperationsServer({ url: grpcBindUrl(process.env, '50056'), internalApiKey, runtime: composition.runtime });
  app.enableShutdownHooks();
  await app.listen();
  process.once('beforeExit', () => { composition.close(); void prisma.$disconnect(); });
}

if (require.main === module) void bootstrap();
