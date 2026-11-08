import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN, cleanup, Harness, startHarness } from '../helpers';

// NFR-TI-01 / ADR-F12b1fix-02: departureDate es la fecha LOCAL del aeropuerto de origen.
// Todas las salidas son de 2030, independientes del reloj real; los números llevan el prefijo de la suite (Z5).
describe('LD-02/04..08 búsqueda por fecha local del aeropuerto de origen', () => {
  let h: Harness = undefined as never;
  let n = 1000;
  beforeAll(async () => { h = await startHarness(); await cleanup(h.prisma); });
  afterAll(async () => {
    if (!h) return;
    try { await cleanup(h.prisma); } finally { await h.close(); }
  });

  const mix = { adults: 1, youths: 0, children: 0, infants: 0 };
  /** Crea un vuelo directamente en la base (para orígenes que Upsert no acepta) y devuelve su número. */
  const flight = async (from: string, to: string, departure: string, flightNumber = `Z5${n++}`): Promise<string> => {
    const departureAt = new Date(departure);
    await h.prisma.flightInstance.create({ data: { flightNumber, departureIata: from, arrivalIata: to, departureAt, arrivalAt: new Date(departureAt.getTime() + 3_600_000), aircraft: 'E190', cabins: { create: { cabinClass: 'ECONOMY', sellable: 5 } } } });
    return flightNumber;
  };
  const search = async (origin: string, destination: string, departureDate: string): Promise<string[]> =>
    (await h.call<{ flights: { segment: { flightNumber: string } }[] }>('QueryAvailability', { origin, destination, departureDate, passengers: mix })).flights.map((f) => f.segment.flightNumber);
  const find = (flightNumber: string, departureDate: string) => h.call<{ segment: { flightNumber: string; departure: { at: string } } }>('FindFlightInstance', { flightNumber, departureDate });
  const list = async (date: string): Promise<string[]> =>
    (await h.call<{ items: { segment: { flightNumber: string } }[] }>('ListFlightInstances', { date, page: { limit: 200 } }, ADMIN)).items.map((i) => i.segment.flightNumber).filter((x) => x.startsWith('Z5'));

  it('LD-04 nocturnos de Ecuador: 19:00, 22:00 y 23:59 locales se encuentran por su fecha local y no por la UTC', async () => {
    const a = await flight('UIO', 'GYE', '2030-06-11T00:00:00Z'); // 19:00 del 10
    const b = await flight('UIO', 'GYE', '2030-06-11T03:00:00Z'); // 22:00 del 10
    const c = await flight('UIO', 'GYE', '2030-06-11T04:59:00Z'); // 23:59 del 10
    expect(await search('UIO', 'GYE', '2030-06-10')).toEqual([a, b, c]);
    expect(await search('UIO', 'GYE', '2030-06-11')).toEqual([]);
    expect((await find(b, '2030-06-10')).segment.flightNumber).toBe(b);
    await expect(find(b, '2030-06-11')).rejects.toMatchObject({ code: 5 });
  });

  it('LD-05 caso Lima: LIM→MAD el 10 a las 22:30 locales (11 a las 03:30Z) y la salida del seed 01:30Z (20:30 del día anterior)', async () => {
    const late = await flight('LIM', 'MAD', '2030-06-11T03:30:00Z');
    const seedLike = await flight('LIM', 'MAD', '2030-06-14T01:30:00Z');
    expect(await search('LIM', 'MAD', '2030-06-10')).toEqual([late]);
    expect(await search('LIM', 'MAD', '2030-06-11')).toEqual([]);
    expect(await search('LIM', 'MAD', '2030-06-13')).toEqual([seedLike]);
    expect(await search('LIM', 'MAD', '2030-06-14')).toEqual([]);
    expect((await find(late, '2030-06-10')).segment.flightNumber).toBe(late);
  });

  it('LD-06 madrugada: 00:05 y 03:00 locales de Ecuador, y 00:05 de Madrid (22:05Z del día anterior)', async () => {
    const e1 = await flight('GYE', 'UIO', '2030-07-10T05:05:00Z');
    const e2 = await flight('GYE', 'UIO', '2030-07-10T08:00:00Z');
    const m1 = await flight('MAD', 'LIM', '2030-07-09T22:05:00Z');
    expect(await search('GYE', 'UIO', '2030-07-10')).toEqual([e1, e2]);
    expect(await search('GYE', 'UIO', '2030-07-09')).toEqual([]);
    expect(await search('MAD', 'LIM', '2030-07-10')).toEqual([m1]);
    expect(await search('MAD', 'LIM', '2030-07-09')).toEqual([]);
  });

  it('LD-02 bordes exactos: 00:00:00.000 local es del día D; 23:59:59.999 también; 00:00 del siguiente no', async () => {
    const first = await flight('CUE', 'UIO', '2030-08-10T05:00:00.000Z');
    const last = await flight('CUE', 'UIO', '2030-08-11T04:59:59.999Z');
    const next = await flight('CUE', 'UIO', '2030-08-11T05:00:00.000Z');
    const before = await flight('CUE', 'UIO', '2030-08-10T04:59:59.999Z');
    expect(await search('CUE', 'UIO', '2030-08-10')).toEqual([first, last]);
    expect(await search('CUE', 'UIO', '2030-08-11')).toEqual([next]);
    expect(await search('CUE', 'UIO', '2030-08-09')).toEqual([before]);
  });

  it('LD-07 List y Find sin origen: cada vuelo se compara con la ventana de su propio origen, y el día de 25 h devuelve la salida más temprana', async () => {
    const ecuador = await flight('UIO', 'BOG', '2030-09-11T00:00:00Z'); // 19:00 del 10
    const lima = await flight('LIM', 'BOG', '2030-09-11T03:30:00Z'); // 22:30 del 10
    const madrid = await flight('MAD', 'BOG', '2030-09-09T22:05:00Z'); // 00:05 del 10 (CEST)
    const utcOnly = await flight('QQQ', 'RRR', '2030-09-10T23:00:00Z'); // sin zona: día UTC
    const outside = await flight('UIO', 'BOG', '2030-09-10T04:59:00Z'); // 23:59 del 9
    const day = await list('2030-09-10');
    expect(day.sort()).toEqual([ecuador, lima, madrid, utcOnly].sort());
    expect(day).not.toContain(outside);
    expect(await search('QQQ', 'RRR', '2030-09-10')).toEqual([utcOnly]);
    const number = 'Z5900';
    await flight('MIA', 'BOG', '2030-11-04T04:30:00Z', number); // 23:30 EST del 3 (segunda)
    await flight('MIA', 'BOG', '2030-11-03T04:30:00Z', number); // 00:30 EDT del 3 (primera): día local de 25 h
    expect((await find(number, '2030-11-03')).segment.departure.at).toBe('2030-11-03T04:30:00.000Z');
  });

  it('LD-08 Upsert rechaza un aeropuerto de salida sin zona; con zona lo acepta y se busca por su fecha local', async () => {
    const request = (departureIata: string) => ({ flightNumber: 'Z5800', departureIata, arrivalIata: 'GYE', departureAt: '2030-10-11T03:30:00Z', arrivalAt: '2030-10-11T05:00:00Z', cabins: [{ cabinClass: 'ECONOMY', capacity: 4 }], aircraft: 'E190' });
    await expect(h.call('UpsertFlightInstance', request('QQQ'), ADMIN)).rejects.toMatchObject({ code: 3 });
    await h.call('UpsertFlightInstance', request('LIM'), ADMIN);
    expect(await search('LIM', 'GYE', '2030-10-10')).toEqual(['Z5800']);
  });
});
