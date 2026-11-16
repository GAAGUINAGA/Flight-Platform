import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { localDay } from '@flight-platform/shared';
import { ADMIN, cleanup, Harness, holdRequest, ownerId, startHarness } from '../helpers';

/** F12c-4c (Postgres real): crear un vuelo CERRADO, no se ve ni se aparta, se abre, duplicado por día local, reintento idempotente. */
describe('INV-C-DB vuelos creados cerrados y abiertos por el administrador', () => {
  let h: Harness = undefined as never;
  beforeAll(async () => { h = await startHarness(); await cleanup(h.prisma); });
  afterAll(async () => { if (!h) return; try { await cleanup(h.prisma); } finally { await h.close(); } });

  const day = new Date(Date.now() + 40 * 86_400_000);
  const number = () => `Z1${1000 + Math.floor(Math.random() * 8999)}`;
  const body = (extra: Record<string, unknown> = {}) => ({
    flightInstanceId: randomUUID(), flightNumber: number(), departureIata: 'UIO', arrivalIata: 'GYE',
    departureAt: new Date(day.getTime() + Math.floor(Math.random() * 3600) * 1000).toISOString(), arrivalAt: new Date(day.getTime() + 4_000_000).toISOString(),
    cabins: [{ cabinClass: 'ECONOMY', capacity: 5 }], aircraft: 'E190', ...extra
  });
  const search = (departureDate: string) => h.call<{ flights: Array<{ segment: { flightInstanceId: string } }> }>('QueryAvailability', { origin: 'UIO', destination: 'GYE', departureDate, passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }, { 'x-role': 'system' });

  it('INV-C-DB-01 nace cerrado: no aparece en la disponibilidad, no admite holds; al abrirlo aparece y admite holds', async () => {
    const request = body(); const created = await h.call<{ flightInstanceId: string; closed: boolean }>('CreateFlightInstance', request, ADMIN);
    expect(created).toMatchObject({ flightInstanceId: request.flightInstanceId, closed: true });
    const date = localDay(new Date(request.departureAt as string), 'America/Guayaquil');
    expect((await search(date)).flights.map((f) => f.segment.flightInstanceId)).not.toContain(request.flightInstanceId);
    await expect(h.call('CreateHold', holdRequest(ownerId(), request.flightInstanceId, 1))).rejects.toBeDefined();
    const opened = await h.call<{ closed: boolean }>('OpenFlightInstance', { flightInstanceId: request.flightInstanceId }, ADMIN); expect(opened.closed).toBe(false);
    expect((await h.call<{ closed: boolean }>('OpenFlightInstance', { flightInstanceId: request.flightInstanceId }, ADMIN)).closed).toBe(false); // idempotente
    expect((await search(date)).flights.map((f) => f.segment.flightInstanceId)).toContain(request.flightInstanceId);
    await expect(h.call('CreateHold', holdRequest(ownerId(), request.flightInstanceId, 1))).resolves.toBeDefined();
  });
  it('INV-C-DB-02 reintento con el mismo id y datos = el existente; mismo número y día local con otro id = FLIGHT_ALREADY_EXISTS; no cliente', async () => {
    const request = body(); await h.call('CreateFlightInstance', request, ADMIN);
    await expect(h.call('CreateFlightInstance', request, ADMIN)).resolves.toMatchObject({ flightInstanceId: request.flightInstanceId });
    expect(await h.prisma.flightInstance.count({ where: { flightNumber: request.flightNumber as string } })).toBe(1);
    await expect(h.call('CreateFlightInstance', { ...request, flightInstanceId: randomUUID(), departureAt: new Date(Date.parse(request.departureAt as string) + 60_000).toISOString() }, ADMIN)).rejects.toMatchObject({ details: 'FLIGHT_ALREADY_EXISTS' });
    await expect(h.call('CreateFlightInstance', { ...request, aircraft: 'A320' }, ADMIN)).rejects.toMatchObject({ details: 'FLIGHT_ALREADY_EXISTS' });
    await expect(h.call('CreateFlightInstance', body(), { 'x-role': 'customer' })).rejects.toMatchObject({ code: 7 });
    await expect(h.call('OpenFlightInstance', { flightInstanceId: request.flightInstanceId }, { 'x-role': 'customer' })).rejects.toMatchObject({ code: 7 });
  });
  it('INV-C-DB-03 validaciones duras del servicio y abrir lo inexistente', async () => {
    for (const bad of [{ aircraft: '' }, { arrivalIata: 'UIO' }, { arrivalIata: 'XXX' }, { departureAt: new Date(Date.now() - 3_600_000).toISOString(), arrivalAt: new Date(Date.now() + 3_600_000).toISOString() }, { cabins: [{ cabinClass: 'ECONOMY', capacity: 0 }] }])
      await expect(h.call('CreateFlightInstance', body(bad), ADMIN)).rejects.toMatchObject({ code: expect.any(Number) });
    await expect(h.call('OpenFlightInstance', { flightInstanceId: randomUUID() }, ADMIN)).rejects.toMatchObject({ details: 'NOT_FOUND' });
  });
});
