import { grpcUrl } from './config';
import process from 'node:process';

export interface GrpcClientTarget { service: string; url: string; tls: boolean; }
export function configuredGrpcTargets(grpcTls: boolean, env: Record<string, string | undefined> = process.env): GrpcClientTarget[] {
  return ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'].map((service) => ({ service, url: grpcUrl(service, env), tls: grpcTls }));
}
