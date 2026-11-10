/* global fetch, __dirname */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse } from 'dotenv';
import { from } from 'rxjs';
import { esbEventClientFromEnv, type EsbEventInput } from '@flight-platform/shared';
import type { INestApplication } from '@nestjs/common';
import { createEsbApp } from '../../../../microservices/esb-service/src/app';
import { loadConfig as loadEsbConfig } from '../../../../microservices/esb-service/src/config';
import { SERVICES } from '../../../../microservices/esb-service/src/domain/catalog';
import { busConsumerFromEnv } from '../../../../microservices/webhooks-service/src/infrastructure/events/amqp-event-bus-consumer';

export interface TestEsb {
  url?: string;
  /** Publica la outbox del ESB al bus (lo que hace el scheduler antes de despachar). Sin efecto fuera del modo bus. */
  pump(): Promise<void>;
  close(): Promise<void>;
}

/** Con GATEWAY_TRANSPORT=grpc las suites no usan el ESB. Cualquier otro valor (incluido ninguno) es el transporte por defecto: esb. */
export const esbTransportEnabled = (): boolean => (process.env.GATEWAY_TRANSPORT ?? 'esb') === 'esb';

/**
 * Modo bus (opt-in, F12b-2): con `GATEWAY_EVENT_BUS=true` el ESB de la suite escribe los eventos en su outbox (esquema `esb`) y los publica a RabbitMQ, y
 * el Webhooks de la suite los retira del bus. Lee `DATABASE_URL`/`RABBITMQ_URL` de los .env del ESB y de Webhooks con dotenv.parse (sin tocar process.env
 * ni imprimir valores): la ejecuta el humano o el auditor. Sin la variable, el ESB reenvía a Webhooks por gRPC como en F12b-1 y nada cambia.
 */
export const busModeEnabled = (): boolean => process.env.GATEWAY_EVENT_BUS === 'true';
const serviceEnv = (service: string): Record<string, string> => { const file = join(__dirname, '..', '..', '..', '..', 'microservices', `${service}-service`, '.env'); return existsSync(file) ? parse(readFileSync(file)) : {}; };

/** Consumidor del bus para el Webhooks de la suite (o `undefined` fuera del modo bus). */
export function testBusConsumer() {
  if (!busModeEnabled()) return undefined;
  const url = serviceEnv('webhooks').RABBITMQ_URL;
  if (!url) throw new Error('RABBITMQ_URL is required in the webhooks .env for GATEWAY_EVENT_BUS=true');
  return busConsumerFromEnv({ RABBITMQ_URL: url }, 'q.webhooks.entrega');
}

/** Publicador de eventos de los servicios emisores de la suite por el ESB (modo bus): mismo cliente que usan en producción. */
export function testEsbEvents(esbUrl: string, internalApiKey: string, service: string) {
  const client = esbEventClientFromEnv({ ESB_URL: esbUrl }, internalApiKey, service);
  return { publishEvent: (input: object) => from(client.publish(input as EsbEventInput)) };
}

/**
 * Levanta el ESB en proceso para la composición de una suite (solo arranque: ninguna aserción cambia). Las direcciones gRPC de los servicios
 * se leen de process.env en cada uso, igual que hacía el Gateway, porque las suites las fijan o cambian después de crear el Gateway.
 * Debe iniciarse antes de `loadConfig` del Gateway: publica `ESB_URL`. Al cerrar restaura el entorno y cierra los clientes gRPC.
 */
export async function startTestEsb(internalApiKey: string): Promise<TestEsb> {
  if (!esbTransportEnabled()) return { pump: async () => undefined, close: async () => undefined };
  const bus = busModeEnabled() ? serviceEnv('esb') : undefined;
  if (bus && (!bus.DATABASE_URL || !bus.RABBITMQ_URL)) throw new Error('DATABASE_URL and RABBITMQ_URL are required in the ESB .env for GATEWAY_EVENT_BUS=true');
  const base = loadEsbConfig({ INTERNAL_API_KEY: internalApiKey, PORT: '1', GRPC_TLS: 'false', ESB_BIND_HOST: '127.0.0.1', ESB_EVENTS_MODE: bus ? 'outbox' : 'grpc', ...(bus ? { DATABASE_URL: bus.DATABASE_URL, RABBITMQ_URL: bus.RABBITMQ_URL } : {}) });
  const grpcUrls = new Proxy({}, { get: (_target, service: string) => process.env[`${service.toUpperCase()}_GRPC_URL`] ?? base.grpcUrls[service as (typeof SERVICES)[number]] }) as typeof base.grpcUrls;
  const app: INestApplication = await createEsbApp({ ...base, grpcUrls }, { logger: { record: () => undefined } });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const prior = process.env.ESB_URL; process.env.ESB_URL = url;
  return {
    url,
    pump: async () => {
      if (!bus) return;
      const response = await fetch(`${url}/internal/v1/operations/sistema.publicar-eventos`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': internalApiKey, 'x-role': 'system', 'x-correlation-id': 'test-pump' }, body: JSON.stringify({ input: {} }) });
      if (!response.ok) throw new Error(`event pump failed with HTTP ${response.status}`);
    },
    close: async () => {
      await app.close();
      if (process.env.ESB_URL === url) { if (prior === undefined) delete process.env.ESB_URL; else process.env.ESB_URL = prior; }
    }
  };
}
