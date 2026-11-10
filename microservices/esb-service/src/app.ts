import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import expressFactory from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { EsbConfig } from './config';
import { ExecuteOperation } from './application/execute-operation';
import type { HealthProbe, OperationLogger, ServiceInvoker } from './application/ports';
import { GRPC, httpStatusFor, operationError } from './domain/errors';
import { GrpcServiceInvoker } from './infrastructure/grpc/grpc-invoker';
import { GrpcHealthProbe } from './infrastructure/grpc/health-probe';
import { JsonOperationLogger } from './infrastructure/logging/operation-logger';
import { BUS_HEALTH, EXECUTE_OPERATION, OperationsController } from './infrastructure/http/operations.controller';
import type { EventOperations } from './application/event-ports';
import { buildEventRuntime, type BusHealth } from './infrastructure/events/runtime';

/** Piezas sustituibles en pruebas. Sin ellas se usan los adaptadores reales (gRPC, sondeo gRPC, log JSON a stdout). */
export interface EsbOverrides { invoker?: ServiceInvoker; probe?: HealthProbe; logger?: OperationLogger; events?: EventOperations; busHealth?: () => Promise<BusHealth> }

const sameSecret = (actual: string | undefined, expected: string): boolean => {
  if (!actual) return false;
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
};
const CORRELATION = /^[\x21-\x7e]{1,128}$/;

export async function createEsbApp(config: EsbConfig, overrides: EsbOverrides = {}) {
  const invoker = overrides.invoker ?? new GrpcServiceInvoker(config);
  // Bus de eventos (F12b-2): con ESB_EVENTS_MODE=outbox se componen la outbox y RabbitMQ; en modo grpc no se abre nada.
  const runtime = !overrides.events && config.events.mode === 'outbox' ? buildEventRuntime(config) : undefined;
  const eventOperations = overrides.events ?? runtime?.operations;
  const busHealth = overrides.busHealth ?? runtime?.health;
  const providers = [
    { provide: 'ESB_INVOKER', useValue: invoker },
    { provide: EXECUTE_OPERATION, useValue: new ExecuteOperation(invoker, overrides.probe ?? new GrpcHealthProbe(config), overrides.logger ?? new JsonOperationLogger(), config.deadlines, Date.now, eventOperations ? { operations: eventOperations, mode: config.events.mode } : undefined) },
    { provide: BUS_HEALTH, useValue: busHealth },
    // Los clientes gRPC y la conexión a la BD se cierran al apagar (onModuleDestroy) para que las suites terminen solas.
    { provide: 'ESB_SHUTDOWN', useFactory: () => ({ onModuleDestroy: async () => { await invoker.close(); await runtime?.close(); } }) }
  ];
  class EsbModule {}
  Module({ controllers: [OperationsController], providers })(EsbModule);
  const app = await NestFactory.create(EsbModule, { logger: ['error', 'warn'] });
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');

  express.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-correlation-id');
    res.setHeader('X-Correlation-Id', incoming && CORRELATION.test(incoming) ? incoming : randomUUID());
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Ninguna petición sin la llave interna llega a la mediación ni al análisis del cuerpo (ADR-F12b-09).
  express.use(['/internal', '/health/deps'], (req: Request, res: Response, next: NextFunction) => {
    if (sameSecret(req.header('x-internal-key'), config.internalApiKey)) return next();
    const error = operationError('esb', GRPC.UNAUTHENTICATED);
    res.status(httpStatusFor(error)).json({ ok: false, error, correlationId: String(res.getHeader('X-Correlation-Id')) });
  });
  express.use('/internal', expressFactory.json({ limit: config.maxBodyBytes }));
  express.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    const outcome = operationError('esb', tooLarge || (typeof error === 'object' && error !== null && 'status' in error && error.status === 400) ? GRPC.INVALID_ARGUMENT : GRPC.INTERNAL);
    res.status(tooLarge ? 413 : httpStatusFor(outcome)).json({ ok: false, error: outcome, correlationId: String(res.getHeader('X-Correlation-Id')) });
  });
  await app.init();
  return app;
}
