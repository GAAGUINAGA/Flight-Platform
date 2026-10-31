/**
 * Dirección de escucha gRPC. Por defecto 0.0.0.0 (Cloud Run lo necesita). Con INTEGRATION_LOCAL=true (perfil de la reunión, red privada)
 * el servicio escucha solo en 127.0.0.1 y únicamente el Gateway lo alcanza. Ese perfil se rechaza con NODE_ENV=production.
 * GRPC_BIND_HOST fuerza una dirección concreta.
 */
export function grpcBindUrl(env: Record<string, string | undefined>, defaultPort: string): string {
  const local = env.INTEGRATION_LOCAL === 'true';
  if (local && env.NODE_ENV === 'production') throw new Error('INTEGRATION_LOCAL is forbidden in production');
  return `${env.GRPC_BIND_HOST ?? (local ? '127.0.0.1' : '0.0.0.0')}:${env.PORT ?? defaultPort}`;
}
