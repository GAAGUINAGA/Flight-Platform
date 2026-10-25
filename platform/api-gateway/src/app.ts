import { randomUUID } from 'node:crypto';
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
    { provide: GatewayScheduler, useFactory: (store: PrismaSchedulerStore) => new GatewayScheduler(config, store), inject: [PrismaSchedulerStore] },
    ...(testComponents ? [{ provide: testComponents.GatewayTestGrpcClient, useFactory: () => new testComponents.GatewayTestGrpcClient(config) }] : []),
    { provide: JwtAuthGuard, useFactory: (reflector: Reflector) => new JwtAuthGuard(reflector, config), inject: [Reflector] },
    { provide: RolesGuard, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] },
    { provide: ScopesGuard, useFactory: (reflector: Reflector) => new ScopesGuard(reflector), inject: [Reflector] },
    { provide: RateLimitGuard, useFactory: () => new RateLimitGuard(config) },
    { provide: APP_GUARD, useExisting: JwtAuthGuard }, { provide: APP_GUARD, useExisting: RolesGuard }, { provide: APP_GUARD, useExisting: ScopesGuard }, { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: IdempotencyInterceptor, useFactory: (reflector: Reflector, store: PrismaIdempotencyStore) => new IdempotencyInterceptor(reflector, process.env.NODE_ENV === 'test' ? new InMemoryGatewayIdempotencyStore(config.idempotencyTtlHours) : store), inject: [Reflector, PrismaIdempotencyStore] }, { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
    GatewayExceptionFilter, { provide: APP_FILTER, useExisting: GatewayExceptionFilter }
  ];
  class GatewayModule {}
  Module({ imports: [LoggerModule.forRoot({ pinoHttp: loggerOptions })], controllers: testComponents ? [HealthController, ShoppingController, HoldController, BookingController, PostSaleController, OperationsController, testComponents.TestController] : [HealthController, ShoppingController, HoldController, BookingController, PostSaleController, OperationsController], providers })(GatewayModule);
  const app = await NestFactory.create(GatewayModule);
  const express = app.getHttpAdapter().getInstance(); express.set('trust proxy', 1);
  express.use(helmet({ hsts: { maxAge: 15552000, includeSubDomains: true } }));
  express.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Correlation-Id', req.header('x-correlation-id') || randomUUID());
    if (req.header('x-forwarded-proto') === 'http') { const problem = { ...asProblem(new Error('http')), status: 400, detail: 'HTTPS is required' }; return res.status(400).type('application/problem+json').json(problem); }
    const origin = req.header('origin'); if (origin && config.corsOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') return res.sendStatus(204); next();
  });
  express.use(expressFactory.json({ limit: '100kb' }));
  const problemAjv = new Ajv({ strict: false }); addFormats(problemAjv);
  const problemSchema = config.validateResponses ? problemAjv.compile((parse(readFileSync(openApiSpecPath(), 'utf8')) as { components: { schemas: { ProblemDetails: object } } }).components.schemas.ProblemDetails) : undefined;
  express.use('/flights/v1', openApiMiddleware({ apiSpec: openApiSpecPath(), validateRequests: true, validateSecurity: false, validateFormats: true, ajvFormats: { mode: 'full' }, validateResponses: config.validateResponses ? {
    onError: (error: Error, body: unknown, request: Request) => {
      // Authentication and missing-hold errors are required by the platform but omitted from individual operations.
      if (/no schema defined for status code '(400|401|403|404|409|410|422|429|503)'/.test(error.message) && problemSchema?.(body)) return;
      void request;
      throw error;
    }
  } : false, ignorePaths: /health|__test/ }));
  express.use((error: unknown, _req: Request, res: Response, next: NextFunction) => { void next; const problem = asProblem(error); const validator = typeof error === 'object' && error !== null && 'errors' in error ? (error as { errors?: Array<{ path?: string; message?: string }> }).errors : undefined; if (Array.isArray(validator)) problem.invalidParams = validator.map((entry) => ({ name: entry.path ?? 'request', reason: entry.message ?? 'invalid' })); res.status(problem.status).type('application/problem+json').json(problem); });
  await app.init();
  return app;
}
