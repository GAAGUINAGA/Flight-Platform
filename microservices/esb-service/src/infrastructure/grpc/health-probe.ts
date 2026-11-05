import { clearTimeout, setTimeout } from 'node:timers';
import { credentials, loadPackageDefinition, Metadata } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { GRPC_HEALTH_PROTO_PATH } from '@flight-platform/shared';
import type { EsbConfig } from '../../config';
import { SERVICES } from '../../domain/catalog';
import type { DependencyHealth, HealthProbe } from '../../application/ports';

interface HealthClient { check(request: { service: string }, metadata: Metadata, options: { deadline: Date }, callback: (error: Error | null, response?: { status?: string }) => void): void; close(): void }
type HealthCtor = new (url: string, creds: ReturnType<typeof credentials.createInsecure>) => HealthClient;
let healthCtor: HealthCtor | undefined;
const loadHealthClient = (): HealthCtor => {
  if (!healthCtor) {
    const definition = loadPackageDefinition(loadSync(GRPC_HEALTH_PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }));
    healthCtor = (definition as unknown as { grpc: { health: { v1: { Health: HealthCtor } } } }).grpc.health.v1.Health;
  }
  return healthCtor;
};

/** Sondeo `grpc.health.v1.Health/Check` de los siete servicios (movido del Gateway). El health de los servicios también exige la llave interna. */
export class GrpcHealthProbe implements HealthProbe {
  constructor(private readonly config: EsbConfig) {}

  check(timeoutMs: number): Promise<DependencyHealth[]> {
    return Promise.all(SERVICES.map((service) => this.probe(service, timeoutMs)));
  }

  private probe(service: string, timeoutMs: number): Promise<DependencyHealth> {
    return new Promise((resolve) => {
      const started = Date.now(); let client: HealthClient | undefined; let finished = false;
      const done = (up: boolean) => {
        if (finished) return; finished = true; clearTimeout(guard);
        try { client?.close(); } catch { /* canal ya cerrado */ }
        resolve({ nombre: `${service}-service`, status: up ? 'UP' : 'DOWN', latencia_ms: Date.now() - started });
      };
      // Tope duro: en algunos sistemas conectar a un puerto cerrado tarda más que el deadline de la llamada.
      const guard = setTimeout(() => done(false), timeoutMs + 50);
      try {
        const Ctor = loadHealthClient();
        client = new Ctor(this.config.grpcUrls[service as keyof EsbConfig['grpcUrls']], this.config.grpcTls ? credentials.createSsl() : credentials.createInsecure());
        const metadata = new Metadata(); metadata.set('x-internal-key', this.config.internalApiKey);
        client.check({ service: '' }, metadata, { deadline: new Date(Date.now() + timeoutMs) }, (error, response) => done(!error && response?.status === 'SERVING'));
      } catch { done(false); }
    });
  }
}
