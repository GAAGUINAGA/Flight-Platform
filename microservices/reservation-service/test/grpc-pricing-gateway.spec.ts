import { expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { throwError } from 'rxjs';
import { GrpcPricingGateway } from '../src/infrastructure/clients/grpc-gateways';
import { safeGrpcError } from '@flight-platform/shared';

it('CreateReservation: un hold inexistente o ajeno conserva NOT_FOUND gRPC sin detalles internos', async () => {
  const gateway = new GrpcPricingGateway(() => ({
    getOfferHold: () => throwError(() => Object.assign(new Error('private detail'), { code: status.NOT_FOUND, details: 'private detail' }))
  }));
  const error = await gateway.getHold({ holdId: 'hold', ownerId: 'owner' }).catch((failure: unknown) => failure);
  expect(safeGrpcError(error)).toEqual({ code: status.NOT_FOUND, details: 'NOT_FOUND' });
});

it('CreateReservation: no confunde otros fallos de Pricing con un hold inexistente', async () => {
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const failure = Object.assign(new Error('unavailable'), { code: status.UNAVAILABLE });
  const gateway = new GrpcPricingGateway(() => ({ getOfferHold: () => throwError(() => failure) }));
  try {
    await expect(gateway.getHold({ holdId: 'hold', ownerId: 'owner' })).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith('dependency=pricing operation=getOfferHold code=14');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/owner|hold|unavailable/);
  } finally { log.mockRestore(); }
});

it('PST-03 / U: conserva FARE_NOT_CHANGEABLE devuelto por Pricing gRPC', async () => {
  const gateway = new GrpcPricingGateway(() => ({
    quoteChange: () => throwError(() => Object.assign(new Error('safe grpc error'), { code: status.FAILED_PRECONDITION, details: 'FARE_NOT_CHANGEABLE' }))
  }));
  await expect(gateway.quoteChange({ ownerId: 'owner' })).rejects.toMatchObject({ code: 'FARE_NOT_CHANGEABLE' });
});
