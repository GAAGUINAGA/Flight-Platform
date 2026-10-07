import { CallOptions, credentials, Metadata } from '@grpc/grpc-js';
import { ClientGrpc, ClientProxyFactory, Transport } from '@nestjs/microservices';
import process from 'node:process';

export interface GrpcClientOptions { url: string; grpcTls?: boolean; internalApiKey: string; correlationId: string; ownerId?: string; role?: string }

export function createGrpcMetadata(options: GrpcClientOptions): Metadata {
  const metadata = new Metadata();
  metadata.set('x-internal-key', options.internalApiKey);
  metadata.set('x-correlation-id', options.correlationId);
  if (options.ownerId) metadata.set('x-owner-id', options.ownerId);
  if (options.role) metadata.set('x-role', options.role);
  return metadata;
}

export function grpcChannelCredentials(grpcTls: boolean) {
  return grpcTls ? credentials.createSsl() : credentials.createInsecure();
}

export const GRPC_DEADLINE_MS = 5_000;

export interface GrpcServiceOptions extends GrpcClientOptions {
  packageName: string;
  protoPath: string;
  serviceName: string;
}

export function createGrpcClient(options: GrpcServiceOptions): ClientGrpc {
  return ClientProxyFactory.create({
    transport: Transport.GRPC,
    options: {
      url: options.url,
      package: options.packageName,
      protoPath: options.protoPath,
      credentials: grpcChannelCredentials(options.grpcTls ?? process.env.GRPC_TLS === 'true')
    }
  }) as ClientGrpc;
}

export function createGrpcService<T extends object>(options: GrpcServiceOptions): T {
  const client = createGrpcClient(options);
  return withGrpcCallContext(client.getService<T>(options.serviceName), options);
}

export function withGrpcCallContext<T extends object>(service: T, options: GrpcClientOptions): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver);
      if (typeof original !== 'function') return original;
      return (request: unknown) => original.call(target, request, createGrpcMetadata(options), {
        deadline: new Date(Date.now() + GRPC_DEADLINE_MS)
      } satisfies CallOptions);
    }
  });
}
