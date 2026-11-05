import { status } from '@grpc/grpc-js';
import { grpcUrl } from './config';
import process from 'node:process';
import type { GatewayConfig } from './config';
import type { AuthContext } from './auth';
import { callEsb, callEsbOperation, deadlineFor, EsbCallError } from './esb-client';
import { ESB_SEAT_MAP } from './esb-operations';

export interface GrpcClientTarget { service: string; url: string; tls: boolean; }
export function configuredGrpcTargets(grpcTls: boolean, env: Record<string, string | undefined> = process.env): GrpcClientTarget[] {
  return ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'].map((service) => ({ service, url: grpcUrl(service, env), tls: grpcTls }));
}

type GatewayGrpcService = 'inventory' | 'pricing' | 'ancillaries' | 'reservation' | 'ticketing' | 'operations' | 'webhooks';

/**
 * Único punto de salida del Gateway hacia los microservicios. Con `GATEWAY_TRANSPORT=esb` (por defecto) va por el ESB (ADR-F12b-02);
 * con `grpc` usa el transporte directo, que se carga bajo demanda para que el modo esb nunca cree un cliente gRPC (ADR-F12b-03).
 * Una configuración sin `transport` (llamadas de prueba directas) usa gRPC.
 */
export async function callGatewayGrpc(
  config: GatewayConfig, service: GatewayGrpcService, method: string, request: object,
  correlationId: string, auth?: AuthContext
): Promise<unknown> {
  if (config.transport === 'esb') return callEsb(config, service, method, request, correlationId, auth);
  const { callDirectGrpc } = await import('./direct-grpc');
  return callDirectGrpc(config, service, method, request, correlationId, auth);
}

/**
 * Mapa de asientos de una oferta: resuelve el segmento (Pricing) y pide el mapa (Ancillaries). Devuelve `undefined` si el segmento
 * no existe (primer paso NOT_FOUND) y relanza cualquier otro error, como hacían los controladores con dos llamadas. Por el ESB es una sola operación.
 */
export async function fetchSeatMap(config: GatewayConfig, offerId: string, segmentId: string, correlationId: string): Promise<unknown | undefined> {
  if (config.transport === 'esb') {
    try { return await callEsbOperation(config, { operation: ESB_SEAT_MAP, input: { offerId, segmentId }, correlationId, deadlineMs: deadlineFor('ancillaries', 'getSeatMapForOffer') }); }
    catch (error) { if (error instanceof EsbCallError && error.code === status.NOT_FOUND && error.step === 'resolveSegment') return undefined; throw error; }
  }
  try { await callGatewayGrpc(config, 'pricing', 'resolveSegment', { segmentId }, correlationId); }
  catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === status.NOT_FOUND) return undefined; throw error; }
  return callGatewayGrpc(config, 'ancillaries', 'getSeatMapForOffer', { offerId, segmentId }, correlationId);
}
