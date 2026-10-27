import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { Response } from 'express';
import { GRPC_HEALTH_PROTO_PATH } from '@flight-platform/shared';
import { grpcUrl, type GatewayConfig } from '../config';
import { v2Controller, v2Route } from './route';

export const HEALTH_SERVICES = ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'] as const;
// Sin estos tres no se puede buscar, bloquear ni reservar: el nodo está DOWN. Con el resto caído solo se degrada.
const CRITICAL = new Set(['inventory', 'pricing', 'reservation']);

interface HealthClient { check(request: { service: string }, options: { deadline: Date }, callback: (error: Error | null, response?: { status?: string }) => void): void; close(): void; }
let healthCtor: (new (url: string, creds: ReturnType<typeof credentials.createInsecure>) => HealthClient) | undefined;
const loadHealthClient = () => {
  if (!healthCtor) {
    const definition = loadPackageDefinition(loadSync(GRPC_HEALTH_PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }));
    healthCtor = (definition as unknown as { grpc: { health: { v1: { Health: typeof healthCtor } } } }).grpc.health.v1.Health;
  }
  return healthCtor!;
};

export interface DependencyHealth { nombre: string; status: 'UP' | 'DOWN'; latencia_ms: number; }
export interface HealthReport { status: 'HEALTHY' | 'DEGRADED' | 'DOWN'; dependencias: DependencyHealth[]; latencia_ms: number; }

const probe = (service: string, url: string, tls: boolean, timeoutMs: number): Promise<DependencyHealth> => new Promise((resolve) => {
  const started = Date.now(); let client: HealthClient | undefined;
  const done = (up: boolean) => { try { client?.close(); } catch { /* canal ya cerrado */ } resolve({ nombre: `${service}-service`, status: up ? 'UP' : 'DOWN', latencia_ms: Date.now() - started }); };
  try {
    const Ctor = loadHealthClient();
    client = new Ctor(url, tls ? credentials.createSsl() : credentials.createInsecure());
    client.check({ service: '' }, { deadline: new Date(Date.now() + timeoutMs) }, (error, response) => done(!error && response?.status === 'SERVING'));
  } catch { done(false); }
});

export class V2HealthService {
  private cached?: { at: number; report: HealthReport };
  private inflight?: Promise<HealthReport>;
  constructor(private readonly config: GatewayConfig) {}

  /** Estado de los siete servicios con tope por sondeo y caché corta: un monitor que consulta a menudo no debe saturar ni colgarse en un arranque en frío. */
  async report(): Promise<HealthReport> {
    const v2 = this.config.v2!;
    if (this.cached && Date.now() - this.cached.at < v2.healthCacheMs) return this.cached.report;
    this.inflight ??= (async () => {
      const started = Date.now();
      const dependencias = await Promise.all(HEALTH_SERVICES.map((service) => probe(service, grpcUrl(service), this.config.grpcTls, v2.healthTimeoutMs)));
      const down = dependencias.filter((d) => d.status === 'DOWN');
      const status = down.some((d) => CRITICAL.has(d.nombre.replace('-service', ''))) ? 'DOWN' : down.length ? 'DEGRADED' : 'HEALTHY';
      const report: HealthReport = { status, dependencias, latencia_ms: Date.now() - started };
      this.cached = { at: Date.now(), report };
      return report;
    })().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }
}

const startedAt = Date.now();

/** `GET /api/v2/vuelos/health`: público, 200 con HEALTHY/DEGRADED y 503 con DOWN (mismo cuerpo). */
export class V2HealthController {
  constructor(private readonly config: GatewayConfig, private readonly health: V2HealthService) {}
  async health_(res: Response): Promise<unknown> {
    const report = await this.health.report(); const v2 = this.config.v2!;
    if (report.status === 'DOWN') res.status(503);
    return {
      status: report.status, nodo_id: v2.nodeId, nombre_proveedor: v2.providerName, vertical: 'VUELOS', version: '2.0.0',
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000), latencia_ms: report.latencia_ms,
      // Aún no hay circuit breaker propio (llega con el orquestador de F12b): se declara cerrado.
      circuit_breaker_estado: 'CLOSED', dependencias: report.dependencias, timestamp: new Date().toISOString()
    };
  }
}
v2Controller(V2HealthController, 'vuelos/health', ['GATEWAY_CONFIG', V2HealthService]);
v2Route(V2HealthController.prototype, 'health_', 'get', '', ['res'], { public: true });
