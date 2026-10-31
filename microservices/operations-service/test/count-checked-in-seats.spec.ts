import { expect, it } from '@jest/globals';
import { PrismaCheckInStore } from '../src/infrastructure/persistence/prisma-check-in';
import { PrismaClient } from '../src/infrastructure/persistence/prisma-client/client';

it('F2-01 / I: adulto con infante en el mismo asiento cuenta un solo CHECKED_IN', async () => {
  const rows = [
    { segmentId: 'flight', bookingId: 'booking', passengerId: 'adult', seat: '12A', cabinClass: 'ECONOMY' },
    { segmentId: 'flight', bookingId: 'booking', passengerId: 'infant', seat: '12A', cabinClass: 'ECONOMY' },
    { segmentId: 'flight', bookingId: 'booking', passengerId: 'other-adult', seat: '12B', cabinClass: 'ECONOMY' }
  ];
  const prisma = { boardingPass: { findMany: async () => rows } } as unknown as PrismaClient;
  const result = await new PrismaCheckInStore(prisma).countCheckedIn(['flight']);
  expect(result).toEqual([{ flightInstanceId: 'flight', cabinClass: 'ECONOMY', seats: 2 }]);
});
