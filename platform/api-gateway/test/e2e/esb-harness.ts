import process from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { createEsbApp } from '../../../../microservices/esb-service/src/app';
import { loadConfig as loadEsbConfig } from '../../../../microservices/esb-service/src/config';
import { SERVICES } from '../../../../microservices/esb-service/src/domain/catalog';

export interface TestEsb { url?: string; close(): Promise<void> }

/** Con GATEWAY_TRANSPORT=grpc las suites no usan el ESB. Cualquier otro valor (incluido ninguno) es el transporte por defecto: esb. */
export const esbTransportEnabled = (): boolean => (process.env.GATEWAY_TRANSPORT ?? 'esb') === 'esb';

/**
 * Levanta el ESB en proceso para la composición de una suite (solo arranque: ninguna aserción cambia). Las direcciones gRPC de los servicios
 * se leen de process.env en cada uso, igual que hacía el Gateway, porque las suites las fijan o cambian después de crear el Gateway.
 * Debe iniciarse antes de `loadConfig` del Gateway: publica `ESB_URL`. Al cerrar restaura el entorno y cierra los clientes gRPC.
 */
export async function startTestEsb(internalApiKey: string): Promise<TestEsb> {
  if (!esbTransportEnabled()) return { close: async () => undefined };
  const base = loadEsbConfig({ INTERNAL_API_KEY: internalApiKey, PORT: '1', GRPC_TLS: 'false', ESB_BIND_HOST: '127.0.0.1' });
  const grpcUrls = new Proxy({}, { get: (_target, service: string) => process.env[`${service.toUpperCase()}_GRPC_URL`] ?? base.grpcUrls[service as (typeof SERVICES)[number]] }) as typeof base.grpcUrls;
  const app: INestApplication = await createEsbApp({ ...base, grpcUrls }, { logger: { record: () => undefined } });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const prior = process.env.ESB_URL; process.env.ESB_URL = url;
  return {
    url,
    close: async () => {
      await app.close();
      if (process.env.ESB_URL === url) { if (prior === undefined) delete process.env.ESB_URL; else process.env.ESB_URL = prior; }
    }
  };
}
