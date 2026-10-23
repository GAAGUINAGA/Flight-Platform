/* global __dirname */
import { grpcUrl } from './config';
import process from 'node:process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { lastValueFrom, type Observable } from 'rxjs';
import { createGrpcClient, createGrpcMetadata, GRPC_DEADLINE_MS } from '@flight-platform/shared';
import type { GatewayConfig } from './config';
import type { AuthContext } from './auth';

export interface GrpcClientTarget { service: string; url: string; tls: boolean; }
export function configuredGrpcTargets(grpcTls: boolean, env: Record<string, string | undefined> = process.env): GrpcClientTarget[] {
  return ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'].map((service) => ({ service, url: grpcUrl(service, env), tls: grpcTls }));
}

type GatewayGrpcService = 'pricing' | 'ancillaries' | 'reservation' | 'ticketing' | 'operations';
type UnaryMethods = Record<string, (request: object, metadata: ReturnType<typeof createGrpcMetadata>, options: { deadline: Date }) => Observable<unknown>>;

function protoRoot(): string {
  let directory = __dirname;
  for (;;) {
    const root = join(directory, 'contracts', 'proto');
    if (existsSync(root)) return root;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('gRPC contracts not found');
    directory = parent;
  }
}

/** Invoca un RPC con la identidad autenticada y cierra el canal al terminar. */
export async function callGatewayGrpc(
  config: GatewayConfig, service: GatewayGrpcService, method: string, request: object,
  correlationId: string, auth?: AuthContext
): Promise<unknown> {
  const url = grpcUrl(service);
  const root = protoRoot();
  const packageName = `flightplatform.${service}.v1`;
  const serviceName = `${service[0].toUpperCase()}${service.slice(1)}Service`;
  const context = { url, grpcTls: config.grpcTls, internalApiKey: config.internalApiKey, correlationId, ownerId: auth?.ownerId, role: auth?.role };
  const client = createGrpcClient({ ...context, packageName, protoPath: join(root, 'flightplatform', service, 'v1', `${service}.proto`), serviceName });
  try {
    const grpc = client.getService<UnaryMethods>(serviceName);
    if (typeof grpc[method] !== 'function') throw new Error('Unknown gRPC method');
    const orchestrated = service === 'reservation' && ['createReservation', 'addBaggage', 'confirmDateChange', 'cancelReservation'].includes(method);
    const configured = Number(process.env.GATEWAY_ORCHESTRATION_DEADLINE_MS ?? 30000);
    const deadlineMs = orchestrated && Number.isFinite(configured) && configured > 0 ? configured : GRPC_DEADLINE_MS;
    return await lastValueFrom(grpc[method](request, createGrpcMetadata(context), { deadline: new Date(Date.now() + deadlineMs) }));
  } finally {
    await (client as unknown as { close(): Promise<void> | void }).close();
  }
}
