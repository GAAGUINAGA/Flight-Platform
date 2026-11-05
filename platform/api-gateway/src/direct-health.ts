/**
 * Sondeo gRPC directo de los siete servicios (GATEWAY_TRANSPORT=grpc, ADR-F12b-03). Con transporte esb el sondeo lo hace el ESB
 * (`sistema.salud`) y este módulo no se carga. Se retira en F12b-3.
 */
import { clearTimeout, setTimeout } from 'node:timers';
import { credentials, loadPackageDefinition, Metadata } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { GRPC_HEALTH_PROTO_PATH } from '@flight-platform/shared';

interface HealthClient { check(request: { service: string }, metadata: Metadata, options: { deadline: Date }, callback: (error: Error | null, response?: { status?: string }) => void): void; close(): void; }
let healthCtor: (new (url: string, creds: ReturnType<typeof credentials.createInsecure>) => HealthClient) | undefined;
const loadHealthClient = () => {
  if (!healthCtor) {
    const definition = loadPackageDefinition(loadSync(GRPC_HEALTH_PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }));
    healthCtor = (definition as unknown as { grpc: { health: { v1: { Health: typeof healthCtor } } } }).grpc.health.v1.Health;
  }
  return healthCtor!;
};

export interface DirectDependencyHealth { nombre: string; status: 'UP' | 'DOWN'; latencia_ms: number; }

export const probeDirect = (service: string, url: string, tls: boolean, timeoutMs: number, internalApiKey: string): Promise<DirectDependencyHealth> => new Promise((resolve) => {
  const started = Date.now(); let client: HealthClient | undefined;
  let finished = false;
  const done = (up: boolean) => { if (finished) return; finished = true; clearTimeout(guard); try { client?.close(); } catch { /* canal ya cerrado */ } resolve({ nombre: `${service}-service`, status: up ? 'UP' : 'DOWN', latencia_ms: Date.now() - started }); };
  // Tope duro: en algunos sistemas conectar a un puerto cerrado tarda más que el deadline de la llamada.
  const guard = setTimeout(() => done(false), timeoutMs + 50);
  try {
    const Ctor = loadHealthClient();
    client = new Ctor(url, tls ? credentials.createSsl() : credentials.createInsecure());
    // El health de los servicios también exige la llave interna (ADR-0-04): sin ella todos responderían UNAUTHENTICATED.
    const metadata = new Metadata(); metadata.set('x-internal-key', internalApiKey);
    client.check({ service: '' }, metadata, { deadline: new Date(Date.now() + timeoutMs) }, (error, response) => done(!error && response?.status === 'SERVING'));
  } catch { done(false); }
});
