import type { ServiceName } from '../domain/catalog';

/** Identidad y correlación que el Gateway envía y el ESB reenvía sin interpretar (ADR-F12b-09). */
export interface CallContext { correlationId: string; ownerId?: string; role?: string }

export interface ServiceInvoker {
  /** Llama a un RPC unario con el plazo absoluto `deadlineAt`. Lanza `{code, details}` como los clientes gRPC. */
  invoke(service: ServiceName, method: string, input: object, context: CallContext, deadlineAt: Date): Promise<unknown>;
  close(): Promise<void>;
}

export interface DependencyHealth { nombre: string; status: 'UP' | 'DOWN'; latencia_ms: number }
export interface HealthProbe { check(timeoutMs: number): Promise<DependencyHealth[]> }

export interface OperationLogEntry {
  operation: string; domain: string; outcome: 'ok' | 'error'; grpcCode: number; catalogCode: string | null; source?: 'service' | 'esb'; latencyMs: number; correlationId: string;
}
export interface OperationLogger { record(entry: OperationLogEntry): void }
