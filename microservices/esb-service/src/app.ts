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
import { EXECUTE_OPERATION, OperationsController } from './infrastructure/http/operations.controller';

/** Piezas sustituibles en pruebas. Sin ellas se usan los adaptadores reales (gRPC, sondeo gRPC, log JSON a stdout). */
export interface EsbOverrides { invoker?: ServiceInvoker; probe?: HealthProbe; logger?: OperationLogger }

const sameSecret = (actual: string | undefined, expected: string): boolean => {
  if (!actual) return false;
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
};
const CORRELATION = /^[\x21-\x7e]{1,128}$/;

export async function createEsbApp(config: EsbConfig, overrides: EsbOverrides = {}) {
  const invoker = overrides.invoker ?? new GrpcServiceInvoker(config);
  const providers = [
    { provide: 'ESB_INVOKER', useValue: invoker },
    { provide: EXECUTE_OPERATION, useValue: new ExecuteOperation(invoker, overrides.probe ?? new GrpcHealthProbe(config), overrides.logger ?? new JsonOperationLogger(), config.deadlines) },
    // Los clientes gRPC se cierran al apagar (onModuleDestroy) para que las suites terminen solas.
    { provide: 'ESB_SHUTDOWN', useFactory: () => ({ onModuleDestroy: () => invoker.close() }) }
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
