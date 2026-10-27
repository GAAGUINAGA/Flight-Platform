/* global __dirname */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { reservationDependencyDeadline, reservationGrpcService } from './infrastructure/clients/deadline-service';
import { createReservationServer, findProtoRoot } from './infrastructure/grpc/server';
import { FakePaymentVerifier } from './infrastructure/clients/fakes';
import { BookingPaymentVerifier, bookingPaymentsConfigFromEnv, warnIfVerificationOff } from './infrastructure/clients/booking-payments';
import { RoutingPaymentVerifier } from './infrastructure/clients/routing-payment-verifier';
import { GrpcAncillariesGateway, GrpcEventPublisher, GrpcInventoryGateway, GrpcPricingGateway, GrpcServiceForOwner, GrpcTicketingGateway } from './infrastructure/clients/grpc-gateways';
import { PrismaClient } from './infrastructure/persistence/prisma-client/client';
import { PrismaReservationStore } from './infrastructure/persistence/prisma-reservation-store';
import { PrismaBaggageOperations } from './infrastructure/persistence/prisma-baggage-operations';
import { PrismaCancellationQuotes } from './infrastructure/persistence/prisma-cancellation-quotes';
import { SystemClock } from '@flight-platform/shared';
import { createResponseValidator } from './infrastructure/grpc/openapi-response-validator';
import { composeReservation } from './infrastructure/grpc/reservation-composition';

async function bootstrap(): Promise<void> {
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) throw new Error('INTERNAL_API_KEY is required');
  const root = findProtoRoot();
  const factory = (url: string, packageName: string, proto: string, serviceName: string): GrpcServiceForOwner => (ownerId, role) => reservationGrpcService({ url, grpcTls: process.env.GRPC_TLS === 'true', internalApiKey, correlationId: `reservation-${Date.now()}`, ownerId, role, packageName, protoPath: join(root, ...proto.split('/')), serviceName }, reservationDependencyDeadline(serviceName.replace(/Service$/, '')));
  const inventory = new GrpcInventoryGateway(factory(process.env.INVENTORY_GRPC_URL ?? 'localhost:50051', 'flightplatform.inventory.v1', 'flightplatform/inventory/v1/inventory.proto', 'InventoryService'));
  const pricing = new GrpcPricingGateway(factory(process.env.PRICING_GRPC_URL ?? 'localhost:50052', 'flightplatform.pricing.v1', 'flightplatform/pricing/v1/pricing.proto', 'PricingService'));
  const ancillaries = new GrpcAncillariesGateway(factory(process.env.ANCILLARIES_GRPC_URL ?? 'localhost:50053', 'flightplatform.ancillaries.v1', 'flightplatform/ancillaries/v1/ancillaries.proto', 'AncillariesService'));
  const ticketing = new GrpcTicketingGateway(factory(process.env.TICKETING_GRPC_URL ?? 'localhost:50055', 'flightplatform.ticketing.v1', 'flightplatform/ticketing/v1/ticketing.proto', 'TicketingService'));
  const events = new GrpcEventPublisher(factory(process.env.WEBHOOKS_GRPC_URL ?? 'localhost:50057', 'flightplatform.webhooks.v1', 'flightplatform/webhooks/v1/webhooks.proto', 'WebhooksService'));
  // v1 conserva su verificador; los clientes client_credentials de v2 usan el canal BOOKING (API de pagos de Booking, configurable por entorno).
  const prisma = new PrismaClient(); const store = new PrismaReservationStore(prisma); const bookingPayments = bookingPaymentsConfigFromEnv(); warnIfVerificationOff(bookingPayments); const payment = new RoutingPaymentVerifier(new FakePaymentVerifier(), { BOOKING: new BookingPaymentVerifier(bookingPayments) });
  const deps = composeReservation({ store, pricing, payment, ancillaries, inventory, ticketing, events, operations: new PrismaBaggageOperations(prisma), quotes: new PrismaCancellationQuotes(prisma), clock: new SystemClock(), cutoffHours: Number(process.env.BAGGAGE_CUTOFF_HOURS ?? '4'), holdTtlMinutes: Number(process.env.HOLD_TTL_MINUTES ?? '20'), validateResponse: createResponseValidator() });
  // Perfil de integración local: solo escucha en loopback para no exponer el servicio a la red privada de la reunión.
  const local = process.env.INTEGRATION_LOCAL === 'true'; if (local && process.env.NODE_ENV === 'production') throw new Error('INTEGRATION_LOCAL is forbidden in production');
  const host = process.env.GRPC_BIND_HOST ?? (local ? '127.0.0.1' : '0.0.0.0');
  const app = await createReservationServer({ url: `${host}:${process.env.PORT ?? '50054'}`, internalApiKey, deps });
  app.enableShutdownHooks();
  await app.listen();
}
void bootstrap();
