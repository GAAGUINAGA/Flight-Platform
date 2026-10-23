import { createGrpcClient, createGrpcMetadata, type GrpcServiceOptions } from '@flight-platform/shared';
import process from 'node:process';

/** Aplica un plazo propio a las dependencias de la saga sin modificar el paquete compartido. */
export function reservationGrpcService<T extends object>(options: GrpcServiceOptions, deadlineMs: number): T {
  const service = createGrpcClient(options).getService<T>(options.serviceName);
  return new Proxy(service, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof method !== 'function') return method;
      return (request: unknown) => method.call(target, request, createGrpcMetadata(options), { deadline: new Date(Date.now() + deadlineMs) });
    }
  });
}

export function reservationDependencyDeadline(service: string, env: Record<string, string | undefined> = process.env): number {
  const value = Number(env[`RESERVATION_${service.toUpperCase()}_DEADLINE_MS`] ?? env.RESERVATION_DEPENDENCY_DEADLINE_MS ?? 10000);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid gRPC deadline for ${service}`);
  return value;
}
