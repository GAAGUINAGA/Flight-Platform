import { expect, it } from '@jest/globals';
import { Metadata } from '@grpc/grpc-js';
import { buildRequestContext } from '@flight-platform/shared';
import { AncillariesController } from '../src/infrastructure/grpc/ancillaries.controller';

const key = 'a'.repeat(40);
const bookingId = '00000000-0000-4000-8000-000000000001';
const controller = new AncillariesController({ seats: { assignments: async () => [] } as never });

it('ANC-SEC-02 / S: controlador sin contexto u ownerId devuelve NOT_FOUND controlado', async () => {
  expect(() => controller.getAssignments({ bookingId }, undefined as unknown as Metadata)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  const metadata = new Metadata();
  metadata.set('x-internal-key', key);
  buildRequestContext(metadata, key);
  expect(() => controller.getAssignments({ bookingId }, metadata)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
});
