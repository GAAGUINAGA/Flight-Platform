import type { CallContext, DependencyHealth, HealthProbe, OperationLogEntry, OperationLogger, ServiceInvoker } from '../../src/application/ports';
import type { EsbConfig } from '../../src/config';
import type { ServiceName } from '../../src/domain/catalog';
import { DEFAULT_EVENT_LIMITS } from '../../src/application/event-operations';
import { DEFAULT_RETRY_TTLS_MS } from '../../src/domain/events';

export const KEY = 'test-internal-key-0123456789';

export const testConfig = (overrides: Partial<EsbConfig> = {}): EsbConfig => ({
  port: 0, bindHost: '127.0.0.1', internalApiKey: KEY, grpcTls: false, maxBodyBytes: 4096,
  grpcUrls: { inventory: '127.0.0.1:1', pricing: '127.0.0.1:1', ancillaries: '127.0.0.1:1', reservation: '127.0.0.1:1', ticketing: '127.0.0.1:1', operations: '127.0.0.1:1', webhooks: '127.0.0.1:1' },
  deadlines: { defaultMs: 5_000, orchestratedMs: 30_000, maxMs: 30_000 },
  events: { mode: 'grpc', limits: DEFAULT_EVENT_LIMITS, retryTtlsMs: [...DEFAULT_RETRY_TTLS_MS], connectTimeoutMs: 3_000 },
  ...overrides
});

export interface InvokeCall { service: ServiceName; method: string; input: object; context: CallContext; deadlineAt: Date }

export class FakeInvoker implements ServiceInvoker {
  calls: InvokeCall[] = []; closed = 0;
  constructor(private readonly handler: (call: InvokeCall) => unknown = () => ({ ok: true })) {}
  async invoke(service: ServiceName, method: string, input: object, context: CallContext, deadlineAt: Date): Promise<unknown> {
    const call = { service, method, input, context, deadlineAt }; this.calls.push(call);
    const value = this.handler(call);
    if (value instanceof Error) throw value;
    return value;
  }
  async close(): Promise<void> { this.closed += 1; }
}

export const grpcError = (code: number, details?: string): Error => Object.assign(new Error('internal detail that must never leave the ESB'), { code, details });

export class FakeProbe implements HealthProbe {
  timeouts: number[] = [];
  constructor(private readonly down: string[] = []) {}
  async check(timeoutMs: number): Promise<DependencyHealth[]> {
    this.timeouts.push(timeoutMs);
    return ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'].map((name) => ({ nombre: `${name}-service`, status: this.down.includes(name) ? 'DOWN' as const : 'UP' as const, latencia_ms: 1 }));
  }
}

export class MemoryLogger implements OperationLogger {
  entries: OperationLogEntry[] = [];
  record(entry: OperationLogEntry): void { this.entries.push(entry); }
}
