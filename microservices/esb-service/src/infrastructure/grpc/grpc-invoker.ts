/* global __dirname */
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { OnModuleDestroy } from '@nestjs/common';
import { lastValueFrom, type Observable } from 'rxjs';
import { createGrpcClient, createGrpcMetadata } from '@flight-platform/shared';
import type { EsbConfig } from '../../config';
import type { ServiceName } from '../../domain/catalog';
import type { CallContext, ServiceInvoker } from '../../application/ports';

type Metadata = ReturnType<typeof createGrpcMetadata>;
type UnaryMethods = Record<string, (request: object, metadata: Metadata, options: { deadline: Date }) => Observable<unknown>>;
type Client = ReturnType<typeof createGrpcClient>;

export function protoRoot(start: string = __dirname): string {
  let directory = start;
  for (;;) {
    const root = join(directory, 'contracts', 'proto');
    if (existsSync(root)) return root;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('gRPC contracts not found');
    directory = parent;
  }
}

/**
 * Clientes gRPC a los siete servicios, movidos del Gateway (ADR-F12b-01). Se crean al primer uso, se reutilizan
 * (cada llamada lleva su plazo y su identidad en metadatos) y se cierran todos al apagar el ESB.
 */
export class GrpcServiceInvoker implements ServiceInvoker, OnModuleDestroy {
  private readonly clients = new Map<ServiceName, { client: Client; service: UnaryMethods }>();
  constructor(private readonly config: EsbConfig, private readonly root: string = protoRoot()) {}

  private clientFor(service: ServiceName) {
    let entry = this.clients.get(service);
    if (!entry) {
      const serviceName = `${service[0].toUpperCase()}${service.slice(1)}Service`;
      const client = createGrpcClient({
        url: this.config.grpcUrls[service], grpcTls: this.config.grpcTls, internalApiKey: this.config.internalApiKey, correlationId: 'esb',
        packageName: `flightplatform.${service}.v1`, protoPath: join(this.root, 'flightplatform', service, 'v1', `${service}.proto`), serviceName
      });
      entry = { client, service: client.getService<UnaryMethods>(serviceName) };
      this.clients.set(service, entry);
    }
    return entry.service;
  }

  async invoke(service: ServiceName, method: string, input: object, context: CallContext, deadlineAt: Date): Promise<unknown> {
    const grpc = this.clientFor(service);
    if (typeof grpc[method] !== 'function') throw new Error('Unknown gRPC method');
    const metadata = createGrpcMetadata({ url: this.config.grpcUrls[service], internalApiKey: this.config.internalApiKey, correlationId: context.correlationId, ownerId: context.ownerId, role: context.role });
    return lastValueFrom(grpc[method](input, metadata, { deadline: deadlineAt }));
  }

  async close(): Promise<void> {
    const entries = [...this.clients.values()]; this.clients.clear();
    await Promise.all(entries.map(async ({ client }) => { try { await (client as unknown as { close(): Promise<void> | void }).close(); } catch { /* canal ya cerrado */ } }));
  }

  async onModuleDestroy(): Promise<void> { await this.close(); }
}
