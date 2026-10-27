import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import expressFactory from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { middleware as openApiMiddleware } from 'express-openapi-validator';
import { Body, Controller, Get, Inject, Module, Post, Req } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory, Reflector } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loggerOptions } from '@flight-platform/shared';
import type { GatewayConfig } from './config';
import { PrismaClient } from '../generated/prisma-client';
import { PrismaIdempotencyStore } from './prisma-idempotency';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { InMemoryGatewayIdempotencyStore } from './idempotency';
import { PrismaSchedulerStore } from './scheduler-store';
import { GatewayScheduler } from './scheduler';
import { Idempotent, JwtAuthGuard, Public, RateLimitGuard, Roles, RolesGuard, Scopes, ScopesGuard } from './security';
import { GatewayExceptionFilter, asProblem } from './web-errors';
import type { GatewayTestGrpcClient } from './test-grpc';
import { openApiSpecPath } from './openapi-path';
import { ShoppingController } from './shopping.controller';
import { HoldController } from './hold.controller';
import { BookingController } from './booking.controller';
import { PostSaleController } from './post-sale.controller';
import { OperationsController } from './operations.controller';
import { WebhooksController } from './webhooks.controller';
import { AdminController } from './admin.controller';
import { AnyScopeGuard } from './v2/v2-security';
import { DevAuthService, InMemoryDevAuthClientStore, type DevAuthClientStore } from './v2/dev-auth';
import { PrismaDevAuthClientStore } from './v2/prisma-dev-auth-store';
import { V2AuthController } from './v2/auth.controller';
import { V2HealthController, V2HealthService } from './v2/health.controller';
import { mountV2Http } from './v2/http';
import { V2ShoppingController } from './v2/shopping.controller';
import { V2HoldController } from './v2/hold.controller';
import { V2BookingController } from './v2/booking.controller';
import { V2PostSaleController } from './v2/postsale.controller';
import { InMemoryStockOutbox, PrismaStockOutbox } from './v2/stock/outbox';
import { GrpcStockPusher, StockSync } from './v2/stock/stock-sync';
import { V2EventsController, V2WebhooksController } from './v2/webhooks.controller';
import { V2BookingEventsController } from './v2/booking-events.controller';
import { V2OperationsController } from './v2/operations.controller';
import { InMemoryPromotionStore, PrismaPromotionStore, V2PromotionsController, type PromotionStore } from './v2/promotions';
import { V2IdempotencyInterceptor } from './v2/idempotency';
import { InMemoryV2StateStore, PrismaV2StateStore, type V2StateStore } from './v2/state';

export const DEV_AUTH_STORE = 'DEV_AUTH_STORE';

class HealthController { health() { return { status: 'ok' }; } }
Controller('flights/v1/health')(HealthController); Get()(HealthController.prototype, 'health', Object.getOwnPropertyDescriptor(HealthController.prototype, 'health')!); Public()(HealthController.prototype, 'health', Object.getOwnPropertyDescriptor(HealthController.prototype, 'health')!);

async function createTestComponents() {
  const { GatewayTestGrpcClient } = await import('./test-grpc');
  class TestController {
    constructor(private readonly grpc: GatewayTestGrpcClient) {}
    async secured(req: Request, body: unknown) {
      const pii = body as { documentNumber?: unknown; email?: unknown };
      (req as Request & { log?: { info: (object: unknown, message: string) => void } }).log?.info({ documentNumber: pii?.documentNumber, email: pii?.email, authorization: req.header('authorization') }, 'gateway test request');
      return this.grpc.execute(req.auth!, String(req.res?.getHeader('X-Correlation-Id') ?? ''));
    }
    admin() { return { admin: true }; }
    unexpected() { throw new Error('forced internal failure must never reach the client'); }
  }
  Controller('flights/v1/__test')(TestController);
  Inject(GatewayTestGrpcClient)(TestController, undefined, 0);
  Post('secured')(TestController.prototype, 'secured', Object.getOwnPropertyDescriptor(TestController.prototype, 'secured')!); Req()(TestController.prototype, 'secured', 0); Body()(TestController.prototype, 'secured', 1); Scopes('flights:read')(TestController.prototype, 'secured', Object.getOwnPropertyDescriptor(TestController.prototype, 'secured')!); Idempotent()(TestController.prototype, 'secured', Object.getOwnPropertyDescriptor(TestController.prototype, 'secured')!);
  Post('admin')(TestController.prototype, 'admin', Object.getOwnPropertyDescriptor(TestController.prototype, 'admin')!); Roles('admin')(TestController.prototype, 'admin', Object.getOwnPropertyDescriptor(TestController.prototype, 'admin')!);
  Post('unexpected')(TestController.prototype, 'unexpected', Object.getOwnPropertyDescriptor(TestController.prototype, 'unexpected')!); Scopes('flights:read')(TestController.prototype, 'unexpected', Object.getOwnPropertyDescriptor(TestController.prototype, 'unexpected')!);
  return { GatewayTestGrpcClient, TestController };
}

export async function createGatewayApp(config: GatewayConfig) {
  const testComponents = process.env.NODE_ENV === 'test' ? await createTestComponents() : undefined;
  const providers = [
    { provide: 'GATEWAY_CONFIG', useValue: config },
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    { provide: PrismaIdempotencyStore, useFactory: (client: PrismaClient) => new PrismaIdempotencyStore(client, config.idempotencyTtlHours), inject: [PrismaClient] },
    { provide: PrismaSchedulerStore, useFactory: (client: PrismaClient) => new PrismaSchedulerStore(client), inject: [PrismaClient] },
    { provide: 'STOCK_SYNC', useFactory: (client: PrismaClient) => new StockSync(config, config.v2!.stock.store === 'memory' ? new InMemoryStockOutbox() : new PrismaStockOutbox(client), new GrpcStockPusher(config.v2!.stock)), inject: [PrismaClient] },
    { provide: GatewayScheduler, useFactory: (store: PrismaSchedulerStore, stock: StockSync) => new GatewayScheduler(config, store, undefined, stock), inject: [PrismaSchedulerStore, 'STOCK_SYNC'] },
    ...(testComponents ? [{ provide: testComponents.GatewayTestGrpcClient, useFactory: () => new testComponents.GatewayTestGrpcClient(config) }] : []),
    { provide: DEV_AUTH_STORE, useFactory: (client: PrismaClient): DevAuthClientStore => config.v2!.devAuth.store === 'memory' ? new InMemoryDevAuthClientStore() : new PrismaDevAuthClientStore(client), inject: [PrismaClient] },
    { provide: DevAuthService, useFactory: (store: DevAuthClientStore) => DevAuthService.create(config.v2!, store), inject: [DEV_AUTH_STORE] },
    { provide: V2HealthService, useFactory: () => new V2HealthService(config) },
    { provide: 'V2_STATE', useFactory: (client: PrismaClient): V2StateStore => config.v2!.stateStore === 'memory' ? new InMemoryV2StateStore() : new PrismaV2StateStore(client), inject: [PrismaClient] },
    { provide: 'V2_PROMOTIONS', useFactory: (client: PrismaClient): PromotionStore => config.v2!.stateStore === 'memory' ? new InMemoryPromotionStore() : new PrismaPromotionStore(client), inject: [PrismaClient] },
    { provide: V2IdempotencyInterceptor, useFactory: (reflector: Reflector, store: PrismaIdempotencyStore) => new V2IdempotencyInterceptor(reflector, process.env.NODE_ENV === 'test' ? new InMemoryGatewayIdempotencyStore(config.idempotencyTtlHours) : store), inject: [Reflector, PrismaIdempotencyStore] }, { provide: APP_INTERCEPTOR, useExisting: V2IdempotencyInterceptor },
    { provide: JwtAuthGuard, useFactory: (reflector: Reflector, devAuth: DevAuthService) => new JwtAuthGuard(reflector, config, devAuth), inject: [Reflector, DevAuthService] },
    { provide: RolesGuard, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] },
    { provide: ScopesGuard, useFactory: (reflector: Reflector) => new ScopesGuard(reflector), inject: [Reflector] },
    { provide: AnyScopeGuard, useFactory: (reflector: Reflector) => new AnyScopeGuard(reflector), inject: [Reflector] },
    { provide: RateLimitGuard, useFactory: () => new RateLimitGuard(config) },
    { provide: APP_GUARD, useExisting: JwtAuthGuard }, { provide: APP_GUARD, useExisting: RolesGuard }, { provide: APP_GUARD, useExisting: ScopesGuard }, { provide: APP_GUARD, useExisting: AnyScopeGuard }, { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: IdempotencyInterceptor, useFactory: (reflector: Reflector, store: PrismaIdempotencyStore) => new IdempotencyInterceptor(reflector, process.env.NODE_ENV === 'test' ? new InMemoryGatewayIdempotencyStore(config.idempotencyTtlHours) : store), inject: [Reflector, PrismaIdempotencyStore] }, { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
    GatewayExceptionFilter, { provide: APP_FILTER, useExisting: GatewayExceptionFilter }
  ];
  class GatewayModule {}
  const v2Controllers = [V2AuthController, V2HealthController, V2ShoppingController, V2HoldController, V2BookingController, V2PostSaleController, V2WebhooksController, V2EventsController, V2BookingEventsController, V2OperationsController, V2PromotionsController, ...(process.env.NODE_ENV === 'test' ? [(await import('./v2/test-controller')).V2TestController] : [])];
  Module({ imports: [LoggerModule.forRoot({ pinoHttp: loggerOptions })], controllers: testComponents ? [HealthController, ShoppingController, HoldController, BookingController, PostSaleController, OperationsController, WebhooksController, AdminController, ...v2Controllers, testComponents.TestController] : [HealthController, ShoppingController, HoldController, BookingController, PostSaleController, OperationsController, WebhooksController, AdminController, ...v2Controllers], providers })(GatewayModule);
  const app = await NestFactory.create(GatewayModule);
  const express = app.getHttpAdapter().getInstance(); express.set('trust proxy', 1);
  express.use(helmet({ hsts: { maxAge: 15552000, includeSubDomains: true } }));
  express.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Correlation-Id', req.header('x-correlation-id') || randomUUID());
    if (req.header('x-forwarded-proto') === 'http') { const problem = { ...asProblem(new Error('http')), status: 400, detail: 'HTTPS is required' }; return res.status(400).type('application/problem+json').json(problem); }
    const origin = req.header('origin'); if (origin && config.corsOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') return res.sendStatus(204); next();
  });
  // Booking firma el cuerpo exacto que envía: se conserva sin tocar para verificar el HMAC y se admite application/cloudevents+json.
  express.use('/api/v2/vuelos/booking-events', expressFactory.json({ limit: '100kb', type: ['application/json', 'application/cloudevents+json'], verify: (req, _res, buf) => { (req as Request).rawBody = Buffer.from(buf); } }));
  express.use(expressFactory.json({ limit: '100kb' }));
  mountV2Http(express, config);
  const problemAjv = new Ajv({ strict: false }); addFormats(problemAjv);
  const problemSchema = config.validateResponses ? problemAjv.compile((parse(readFileSync(openApiSpecPath(), 'utf8')) as { components: { schemas: { ProblemDetails: object } } }).components.schemas.ProblemDetails) : undefined;
  express.use('/flights/v1', openApiMiddleware({ apiSpec: openApiSpecPath(), validateRequests: true, validateSecurity: false, validateFormats: true, ajvFormats: { mode: 'full' }, validateResponses: config.validateResponses ? {
    onError: (error: Error, body: unknown, request: Request) => {
      // Authentication and missing-hold errors are required by the platform but omitted from individual operations.
      if (/no schema defined for status code '(400|401|403|404|409|410|422|429|503)'/.test(error.message) && problemSchema?.(body)) return;
      void request;
      throw error;
    }
  } : false, ignorePaths: /health|__test|\/admin(\/|$)/ }));
  express.use((error: unknown, _req: Request, res: Response, next: NextFunction) => { void next; const problem = asProblem(error); const validator = typeof error === 'object' && error !== null && 'errors' in error ? (error as { errors?: Array<{ path?: string; message?: string }> }).errors : undefined; if (Array.isArray(validator)) problem.invalidParams = validator.map((entry) => ({ name: entry.path ?? 'request', reason: entry.message ?? 'invalid' })); res.status(problem.status).type('application/problem+json').json(problem); });
  await app.init();
  return app;
}
