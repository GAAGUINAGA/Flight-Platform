import { expect, it } from '@jest/globals';
import { status } from '@grpc/grpc-js';
import { throwError } from 'rxjs';
import { GrpcPricingGateway } from '../src/infrastructure/clients/grpc-gateways';

it('PST-03 / U: conserva FARE_NOT_CHANGEABLE devuelto por Pricing gRPC', async () => {
  const gateway = new GrpcPricingGateway(() => ({
    quoteChange: () => throwError(() => Object.assign(new Error('safe grpc error'), { code: status.FAILED_PRECONDITION, details: 'FARE_NOT_CHANGEABLE' }))
  }));
  await expect(gateway.quoteChange({ ownerId: 'owner' })).rejects.toMatchObject({ code: 'FARE_NOT_CHANGEABLE' });
});
