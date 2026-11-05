import type { Response } from 'express';
import { grpcUrl, type GatewayConfig } from '../config';
import { callEsbOperation } from '../esb-client';
import { ESB_HEALTH } from '../esb-operations';
import { v2Controller, v2Route } from './route';

export const HEALTH_SERVICES = ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'] as const;
// Sin estos tres no se puede buscar, bloquear ni reservar: el nodo está DOWN. Con el resto caído solo se degrada.
const CRITICAL = new Set(['inventory', 'pricing', 'reservation']);

export interface DependencyHealth { nombre: string; status: 'UP' | 'DOWN'; latencia_ms: number; }
export interface HealthReport { status: 'HEALTHY' | 'DEGRADED' | 'DOWN'; dependencias: DependencyHealth[]; latencia_ms: number; }

const CRITICAL_FALLBACK_LATENCY = 0;
/** Con el ESB inaccesible no se puede saber nada de los servicios: el nodo está DOWN y los siete se reportan DOWN. */
const allDown = (): DependencyHealth[] => HEALTH_SERVICES.map((service) => ({ nombre: `${service}-service`, status: 'DOWN' as const, latencia_ms: CRITICAL_FALLBACK_LATENCY }));

export class V2HealthService {
  private cached?: { at: number; report: HealthReport };
  private inflight?: Promise<HealthReport>;
  constructor(private readonly config: GatewayConfig) {}

  /** El ESB sondea los siete servicios y calcula el estado; el Gateway conserva la caché y el formato. */
  private async viaEsb(timeoutMs: number): Promise<{ dependencias: DependencyHealth[]; status: HealthReport['status'] }> {
    try {
      const result = await callEsbOperation(this.config, { operation: ESB_HEALTH, input: { timeoutMs }, correlationId: 'gateway-health', deadlineMs: timeoutMs + 200, abortMarginMs: 100 }) as { dependencias: DependencyHealth[]; status: HealthReport['status'] };
      return { dependencias: result.dependencias, status: result.status };
    } catch { return { dependencias: allDown(), status: 'DOWN' }; }
  }

  private async direct(timeoutMs: number): Promise<{ dependencias: DependencyHealth[]; status: HealthReport['status'] }> {
    const { probeDirect } = await import('../direct-health');
    const dependencias = await Promise.all(HEALTH_SERVICES.map((service) => probeDirect(service, grpcUrl(service), this.config.grpcTls, timeoutMs, this.config.internalApiKey)));
    const down = dependencias.filter((d) => d.status === 'DOWN');
    return { dependencias, status: down.some((d) => CRITICAL.has(d.nombre.replace('-service', ''))) ? 'DOWN' : down.length ? 'DEGRADED' : 'HEALTHY' };
  }

  /** Estado de los siete servicios con tope por sondeo y caché corta: un monitor que consulta a menudo no debe saturar ni colgarse en un arranque en frío. */
  async report(): Promise<HealthReport> {
    const v2 = this.config.v2!;
    if (this.cached && Date.now() - this.cached.at < v2.healthCacheMs) return this.cached.report;
    this.inflight ??= (async () => {
      const started = Date.now();
      const { dependencias, status } = this.config.transport === 'esb' ? await this.viaEsb(v2.healthTimeoutMs) : await this.direct(v2.healthTimeoutMs);
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
