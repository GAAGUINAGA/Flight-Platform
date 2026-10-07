import { status } from '@grpc/grpc-js';
import { RequestContext } from '@flight-platform/shared';
import { RpcException } from '@nestjs/microservices';

/**
 * Defensa en profundidad: si el Gateway propag? x-owner-id, el owner del
 * cuerpo debe coincidir; nunca se act?a sobre un owner distinto al autenticado.
 */
export function assertOwner(ctx: RequestContext, ownerId: string): void {
  if (ctx.ownerId && ctx.ownerId !== ownerId) {
    throw new RpcException({ code: status.PERMISSION_DENIED, details: 'PERMISSION_DENIED' });
  }
}
