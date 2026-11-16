import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { Request } from 'express';

jest.mock('../../src/grpc-clients', () => ({ ...(jest.requireActual('../../src/grpc-clients') as object), callGatewayGrpc: jest.fn() }));
import { callGatewayGrpc } from '../../src/grpc-clients';
import { PrismaClient } from '../../generated/prisma-client';
import { AdminApiController } from '../../src/admin-api';
import { PrismaAdminAccessLog } from '../../src/admin-access-log';
import { InMemoryV2StateStore } from '../../src/v2/state';
import type { GatewayConfig } from '../../src/config';

/** F12c-4b/4c: las cuatro acciones nuevas escriben su fila en `gateway.admin_access_log` REAL (Postgres), con el sujeto validado y sin datos. Las filas `it-…` no se pueden borrar (solo inserción). */
describe('F12c-4b/4c integración: registro de CHECK_IN, BOARDING_PASSES, CREATE_FLIGHT y OPEN_FLIGHT', () => {
  const prisma = new PrismaClient(); let connected = false;
  beforeAll(async () => { await prisma.$connect(); connected = true; });
  afterAll(async () => { if (connected) await prisma.$disconnect(); });
  const config = { transport: 'grpc', admin: { pnrSearchLimitPerHour: 30, checkInLimitPerHour: 60 }, idempotencyTtlHours: 24 } as unknown as GatewayConfig;
  const controller = new AdminApiController(config, new InMemoryV2StateStore(), new PrismaAdminAccessLog(prisma));
  const request = (sub: string, key?: string) => ({ auth: { ownerId: sub, role: 'admin', scopes: new Set(['flights:admin']) }, header: (name: string) => (name.toLowerCase() === 'idempotency-key' ? key : undefined), res: { getHeader: () => 'it-corr', setHeader: () => undefined, status: () => undefined } }) as unknown as Request;
  const rows = (actorSub: string) => prisma.adminAccessLog.findMany({ where: { actorSub }, orderBy: { at: 'asc' } });
  const fare = { cabinClass: 'ECONOMY', fareBrand: 'Basic', baseFare: '80.00', taxes: '20.00', isRefundable: false, isChangeable: true, carryOnIncluded: 1, checkedBaggageIncluded: 0, extraBaggagePrice: '35.00' };

  it('ADM4-LOG-IT-10: cada acción deja una fila con actor, acción, sujeto y resultado; nunca tarifas ni datos', async () => {
    const sub = `it-${randomUUID().slice(0, 12)}`; const flightId = randomUUID();
    jest.mocked(callGatewayGrpc).mockImplementation(async (_c, _s, method) => {
      if (method === 'adminCheckIn') return { bookingId: randomUUID(), status: 'COMPLETED', checkedInPassengers: [] };
      if (method === 'adminListBoardingPasses') return { bookingId: randomUUID(), boardingPasses: [] };
      if (method === 'listAircraftLayouts') return { aircraft: [{ code: 'E190', cabins: [{ cabinClass: 'ECONOMY', seats: 99 }] }] };
      if (method === 'listFares') return { fares: [{ fare: { cabinClass: 'ECONOMY', fareBrand: 'Basic', price: { currency: 'USD', total: '100.00', baseFare: '80.00', taxes: '20.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { total: '35.00' } } }] };
      if (method === 'getFlightInstance') return { cabins: [{ cabinClass: 'ECONOMY', capacity: 99 }] };
      return {};
    });
    await controller.checkInBooking(request(sub, randomUUID()), { pnr: 'J4R8GZ' });
    await controller.boardingPasses(request(sub), { pnr: 'J4R8GZ' });
    await expect(controller.checkInBooking(request(sub, randomUUID()), { pnr: 'texto con ana@example.com' })).rejects.toBeDefined();
    const departureLocal = `${new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)}T15:00`;
    await controller.createFlight(request(sub, randomUUID()), { flightNumber: 'FP4321', origin: 'UIO', destination: 'GPS', departureLocal, durationMinutes: 120, aircraft: 'E190', fares: [fare] });
    await controller.openFlight(request(sub, randomUUID()), flightId);
    await expect(controller.createFlight(request(sub), { flightNumber: 'Ana Pérez ana@example.com' })).rejects.toBeDefined();
    const saved = await rows(sub);
    expect(saved.map((r) => [r.action, r.subject, r.result])).toEqual([['CHECK_IN', 'J4R8GZ', 'OK'], ['BOARDING_PASSES', 'J4R8GZ', 'OK'], ['CHECK_IN', null, 'INVALID_FORMAT'], ['CREATE_FLIGHT', 'FP4321', 'OK'], ['OPEN_FLIGHT', flightId, 'OK'], ['CREATE_FLIGHT', null, 'REJECTED']]);
    expect(saved.every((r) => r.actorSub === sub && r.correlationId === 'it-corr')).toBe(true);
    const text = JSON.stringify(saved); for (const forbidden of ['80.00', '35.00', 'ana@example.com', 'Basic']) expect(text).not.toContain(forbidden);
    expect(await new PrismaAdminAccessLog(prisma).countSince(sub, 'CHECK_IN', new Date(Date.now() - 60_000))).toBe(2);
  });

  it('ADM4-LOG-IT-11 (audit-42): un vuelo con una cabina sin tarifa NO se abre: OPEN_FLIGHT queda REJECTED/FLIGHT_NOT_READY en el registro real; completada la tarifa, abre y queda OK', async () => {
    const sub = `it-${randomUUID().slice(0, 12)}`; const flightId = randomUUID(); const opened: string[] = []; let stored: Array<Record<string, unknown>> = [];
    const good = (cabinClass: string) => ({ fare: { cabinClass, fareBrand: 'Basic', price: { currency: 'USD', total: '100.00', baseFare: '80.00', taxes: '20.00' }, fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { total: '35.00' } } });
    jest.mocked(callGatewayGrpc).mockImplementation(async (_c, _s, method) => {
      if (method === 'getFlightInstance') return { cabins: [{ cabinClass: 'BUSINESS', capacity: 12 }, { cabinClass: 'ECONOMY', capacity: 150 }] };
      if (method === 'listFares') return { fares: stored };
      if (method === 'openFlightInstance') { opened.push(flightId); return {}; }
      return {};
    });
    stored = [good('ECONOMY')]; // falló el guardado de la tarifa de BUSINESS
    await expect(controller.openFlight(request(sub, randomUUID()), flightId)).rejects.toMatchObject({ code: 'FLIGHT_NOT_READY', statusCode: 409 });
    expect(opened).toEqual([]);
    stored = [good('ECONOMY'), good('BUSINESS')];
    await controller.openFlight(request(sub, randomUUID()), flightId); expect(opened).toEqual([flightId]);
    expect((await rows(sub)).map((r) => [r.action, r.subject, r.result, r.errorCode])).toEqual([['OPEN_FLIGHT', flightId, 'REJECTED', 'FLIGHT_NOT_READY'], ['OPEN_FLIGHT', flightId, 'OK', null]]);
  });
});
