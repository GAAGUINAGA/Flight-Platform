import { expect, it } from '@jest/globals';
import { status } from '@grpc/grpc-js';
import { firstValueFrom } from 'rxjs';
import { ReservationExceptionFilter } from '../src/infrastructure/grpc/filters';

it.each([status.UNAVAILABLE, status.DEADLINE_EXCEEDED])('propaga indisponibilidad gRPC %i sin detalles internos', async (code) => {
  const filter = new ReservationExceptionFilter();
  await expect(firstValueFrom(filter.catch({ code, details: 'private information' }))).rejects.toEqual({ code, details: 'Service temporarily unavailable' });
});
