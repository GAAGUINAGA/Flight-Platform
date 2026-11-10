import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ExecuteOperation, OperationResult } from '../../application/execute-operation';
import { operationEnvelope, requestHeaders } from '../../application/schemas';
import { findOperation } from '../../domain/catalog';
import { GRPC, httpStatusFor, operationError } from '../../domain/errors';

export const EXECUTE_OPERATION = 'EXECUTE_OPERATION';
export const BUS_HEALTH = 'ESB_BUS_HEALTH';
const header = (req: Request, name: string): string | undefined => { const value = req.header(name); return value === undefined || value === '' ? undefined : value; };

/** Envuelve el resultado en el sobre de respuesta (ADR-F12b-02) y fija el estado HTTP. */
export function sendOutcome(res: Response, correlationId: string, outcome: OperationResult): void {
  if (outcome.ok) { res.status(200).json({ ok: true, result: outcome.result, correlationId }); return; }
  res.status(httpStatusFor(outcome.error)).json({ ok: false, error: outcome.error, correlationId });
}

/** `POST /internal/v1/operations/:operation`. La llave interna ya fue exigida por el middleware: aquí nunca llega una petición sin ella. */
export class OperationsController {
  constructor(private readonly execute: ExecuteOperation, private readonly busHealth?: () => Promise<unknown>) {}

  async run(operation: string, body: unknown, req: Request, res: Response): Promise<void> {
    const correlationId = String(res.getHeader('X-Correlation-Id'));
    const headers = requestHeaders.safeParse({ correlationId, ownerId: header(req, 'x-owner-id'), role: header(req, 'x-role'), deadlineMs: header(req, 'x-deadline-ms') });
    if (!headers.success) return sendOutcome(res, correlationId, { ok: false, error: operationError('esb', GRPC.INVALID_ARGUMENT) });
    if (!findOperation(operation)) return sendOutcome(res, correlationId, { ok: false, error: operationError('esb', GRPC.UNIMPLEMENTED) });
    const envelope = operationEnvelope.safeParse(body);
    if (!envelope.success) return sendOutcome(res, correlationId, { ok: false, error: operationError('esb', GRPC.INVALID_ARGUMENT) });
    const { ownerId, role, deadlineMs } = headers.data;
    sendOutcome(res, correlationId, await this.execute.execute({ operation, input: envelope.data.input, context: { correlationId, ownerId, role }, deadlineMs }));
  }

  /** Vivo, sin llave y sin tocar a los servicios. */
  live() { return { status: 'ok' }; }

  /** Estado de los siete servicios (con llave): 200 con HEALTHY/DEGRADED, 503 con DOWN. */
  async dependencies(res: Response): Promise<void> {
    const correlationId = String(res.getHeader('X-Correlation-Id'));
    const outcome = await this.execute.execute({ operation: 'sistema.salud', input: {}, context: { correlationId } });
    if (!outcome.ok) return sendOutcome(res, correlationId, outcome);
    // El bloque `bus` va aparte: `sistema.salud` conserva sus siete dependencias y el cálculo HEALTHY/DEGRADED/DOWN del Gateway no cambia.
    const bus = this.busHealth ? await this.busHealth().catch(() => ({ broker: 'DOWN', outboxPendientes: null })) : undefined;
    res.status((outcome.result as { status: string }).status === 'DOWN' ? 503 : 200).json({ ...(outcome.result as object), ...(bus ? { bus } : {}), correlationId });
  }
}
Controller()(OperationsController);
Inject(EXECUTE_OPERATION)(OperationsController, undefined, 0);
Inject(BUS_HEALTH)(OperationsController, undefined, 1); Optional()(OperationsController, undefined, 1);
const descriptor = (name: keyof OperationsController) => Object.getOwnPropertyDescriptor(OperationsController.prototype, name)!;
const proto = OperationsController.prototype;
Post('internal/v1/operations/:operation')(proto, 'run', descriptor('run')); HttpCode(200)(proto, 'run', descriptor('run'));
Param('operation')(proto, 'run', 0); Body()(proto, 'run', 1); Req()(proto, 'run', 2); Res()(proto, 'run', 3);
Get('health')(proto, 'live', descriptor('live'));
Get('health/deps')(proto, 'dependencies', descriptor('dependencies')); Res()(proto, 'dependencies', 0);
