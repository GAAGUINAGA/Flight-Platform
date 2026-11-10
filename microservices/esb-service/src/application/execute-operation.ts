import { findOperation, domainOf, INGEST_EVENT_OPERATION, isOrchestrated, SERVICES, type CompositeOperation, type RpcOperation } from '../domain/catalog';
import type { EventOperations } from './event-ports';
import { resolveDeadlineMs, type DeadlinePolicy } from '../domain/deadline';
import { errorFromThrown, GRPC, operationError, type OperationError } from '../domain/errors';
import type { CallContext, HealthProbe, OperationLogger, ServiceInvoker } from './ports';

export interface OperationRequest { operation: string; input: Record<string, unknown>; context: CallContext; deadlineMs?: number }
export type OperationResult = { ok: true; result: unknown } | { ok: false; error: OperationError };

/** Servicios críticos: sin ellos no se puede buscar, bloquear ni reservar y el nodo está DOWN (misma regla que el Gateway). */
const CRITICAL = new Set(['inventory', 'pricing', 'reservation']);
const HEALTH_DEFAULT_MS = 2_000;
const HEALTH_MAX_MS = 10_000;

/** Caso de uso único del ESB: resuelve la operación con nombre, la ejecuta contra el microservicio y traduce el resultado o el error. */
export class ExecuteOperation {
  constructor(
    private readonly invoker: ServiceInvoker, private readonly probe: HealthProbe, private readonly logger: OperationLogger,
    private readonly policy: DeadlinePolicy, private readonly now: () => number = Date.now,
    /** Bus de eventos (F12b-2). Con `mode: 'grpc'` o sin él, `clientes.publicar-evento` sigue yendo a Webhooks. */
    private readonly events?: { operations: EventOperations; mode: 'outbox' | 'grpc' }
  ) {}

  async execute(request: OperationRequest): Promise<OperationResult> {
    const started = this.now();
    const outcome = await this.run(request);
    this.logger.record({
      operation: request.operation, domain: domainOf(request.operation), outcome: outcome.ok ? 'ok' : 'error',
      grpcCode: outcome.ok ? 0 : outcome.error.grpcCode, catalogCode: outcome.ok ? null : outcome.error.catalogCode,
      ...(outcome.ok ? {} : { source: outcome.error.source }), latencyMs: this.now() - started, correlationId: request.context.correlationId
    });
    return outcome;
  }

  private async run(request: OperationRequest): Promise<OperationResult> {
    const operation = findOperation(request.operation);
    if (!operation) return { ok: false, error: operationError('esb', GRPC.UNIMPLEMENTED) };
    const deadlineMs = resolveDeadlineMs(request.deadlineMs, isOrchestrated(operation), this.policy);
    const deadlineAt = new Date(this.now() + deadlineMs);
    try {
      if (operation.kind === 'health') return { ok: true, result: await this.health(request.input, deadlineMs) };
      if (operation.kind === 'native') return await this.native(operation.roles, request, () => this.requireEvents().publishOutbox(deadlineAt));
      if (operation.kind === 'rpc' && operation.name === INGEST_EVENT_OPERATION && this.events?.mode === 'outbox') {
        return await this.native(['system'], request, () => this.events!.operations.ingest(request.input));
      }
      if (operation.kind === 'rpc') return await this.rpc(operation, request, deadlineAt);
      return await this.composite(operation, request, deadlineAt);
    } catch (thrown) {
      return { ok: false, error: errorFromThrown(thrown) };
    }
  }

  private requireEvents(): EventOperations {
    if (!this.events) throw Object.assign(new Error('event bus not configured'), { code: GRPC.UNIMPLEMENTED });
    return this.events.operations;
  }

  /** Operación que atiende el propio ESB. Mismo control de rol que una operación de sistema; los fallos se traducen como los de un servicio. */
  private async native(roles: readonly string[], request: OperationRequest, run: () => Promise<unknown>): Promise<OperationResult> {
    if (!(request.context.role && roles.includes(request.context.role))) {
      return { ok: false, error: operationError('service', GRPC.PERMISSION_DENIED, 'PERMISSION_DENIED') };
    }
    return { ok: true, result: await run() };
  }

  private async rpc(operation: RpcOperation, request: OperationRequest, deadlineAt: Date): Promise<OperationResult> {
    // Defensa en profundidad (ADR-F12b-09): mismo error que daría el microservicio, sin llegar a llamarlo.
    if (operation.roles && !(request.context.role && operation.roles.includes(request.context.role))) {
      return { ok: false, error: operationError('service', GRPC.PERMISSION_DENIED, 'PERMISSION_DENIED') };
    }
    try {
      return { ok: true, result: await this.invoker.invoke(operation.service, operation.method, request.input, request.context, deadlineAt) };
    } catch (thrown) {
      return { ok: false, error: errorFromThrown(thrown) };
    }
  }

  /** Los pasos corren en orden bajo un único plazo; un fallo corta la cadena y se informa en qué paso ocurrió. */
  private async composite(operation: CompositeOperation, request: OperationRequest, deadlineAt: Date): Promise<OperationResult> {
    let result: unknown;
    for (const step of operation.steps) {
      const input = Object.fromEntries(step.pick.filter((key) => key in request.input).map((key) => [key, request.input[key]]));
      try {
        result = await this.invoker.invoke(step.service, step.method, input, request.context, deadlineAt);
      } catch (thrown) {
        return { ok: false, error: errorFromThrown(thrown, step.method) };
      }
    }
    return { ok: true, result };
  }

  private async health(input: Record<string, unknown>, deadlineMs: number) {
    const asked = typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : HEALTH_DEFAULT_MS;
    const dependencias = await this.probe.check(Math.min(asked, HEALTH_MAX_MS, deadlineMs));
    const down = dependencias.filter((dependency) => dependency.status === 'DOWN');
    const status = down.some((dependency) => CRITICAL.has(dependency.nombre.replace('-service', ''))) ? 'DOWN' : down.length ? 'DEGRADED' : 'HEALTHY';
    return { status, dependencias, expected: SERVICES.length };
  }
}
