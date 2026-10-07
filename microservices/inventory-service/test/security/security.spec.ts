import { afterAll, beforeAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../src/infrastructure/grpc/server';
import { ADMIN, capacity, cleanup, createFlight, Harness, holdRequest, ownerId, startHarness, SYSTEM } from '../helpers';

const uuid = () => randomUUID();
const mix = { adults: 1, youths: 0, children: 0, infants: 0 };
const segment = { flightInstanceId: uuid(), cabinClass: 'ECONOMY', seats: 1 };
const validHold = { ownerId: 'o1', idempotencyKey: 'k', segments: [segment] };

describe('INV-SEC-01 validaci?n Zod de todos los RPCs (INVALID_ARGUMENT)', () => {
  let h: Harness = undefined as never;
  beforeAll(async () => { h = await startHarness(); });
  afterAll(async () => { await h?.close(); });

  const cases: [string, string, unknown, Record<string, string>][] = [
    ['QueryAvailability', 'IATA en min?sculas', { origin: 'uio', destination: 'GYE', departureDate: '2026-12-01', passengers: mix }, { 'x-role': 'customer' }],
    ['QueryAvailability', 'IATA de 4 letras', { origin: 'UIOO', destination: 'GYE', departureDate: '2026-12-01', passengers: mix }, { 'x-role': 'customer' }],
    ['QueryAvailability', 'fecha inexistente', { origin: 'UIO', destination: 'GYE', departureDate: '2026-02-31', passengers: mix }, { 'x-role': 'customer' }],
    ['QueryAvailability', 'cabina fuera del enum', { origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01', passengers: mix, cabinClass: 'CABIN_CLASS_UNSPECIFIED' }, { 'x-role': 'customer' }],
    ['QueryAvailability', '10 pasajeros', { origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01', passengers: { ...mix, adults: 10 } }, { 'x-role': 'customer' }],
    ['QueryAvailability', 'sin pasajeros con asiento', { origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01', passengers: { ...mix, adults: 0 } }, { 'x-role': 'customer' }],
    ['QueryAvailability', 'origen igual a destino', { origin: 'UIO', destination: 'UIO', departureDate: '2026-12-01', passengers: mix }, { 'x-role': 'customer' }],
    ['GetFlightInstance', 'id no uuid', { flightInstanceId: 'abc' }, { 'x-role': 'customer' }],
    ['FindFlightInstance', 'n?mero de vuelo inv?lido', { flightNumber: 'fp-1', departureDate: '2026-12-01' }, { 'x-role': 'customer' }],
    ['ListFlightInstances', 'cursor no uuid', { page: { limit: 10, cursor: 'x' } }, { 'x-role': 'customer' }],
    ['ListFlightInstances', 'l?mite mayor a 200', { page: { limit: 500 } }, { 'x-role': 'customer' }],
    ['UpsertFlightInstance', 'sin cabinas', { flightNumber: 'FP1', departureIata: 'UIO', arrivalIata: 'GYE', departureAt: '2026-12-01T10:00:00Z', arrivalAt: '2026-12-01T11:00:00Z', cabins: [] }, ADMIN],
    ['UpsertFlightInstance', 'llegada antes de la salida', { flightNumber: 'FP1', departureIata: 'UIO', arrivalIata: 'GYE', departureAt: '2026-12-01T10:00:00Z', arrivalAt: '2026-12-01T09:00:00Z', cabins: [{ cabinClass: 'ECONOMY', capacity: 5 }] }, ADMIN],
    ['UpsertFlightInstance', 'capacidad negativa/enorme', { flightNumber: 'FP1', departureIata: 'UIO', arrivalIata: 'GYE', departureAt: '2026-12-01T10:00:00Z', arrivalAt: '2026-12-01T11:00:00Z', cabins: [{ cabinClass: 'ECONOMY', capacity: 100000 }] }, ADMIN],
    ['CloseFlightInstance', 'id no uuid', { flightInstanceId: '1' }, ADMIN],
    ['CreateHold', '0 asientos', { ...validHold, segments: [{ ...segment, seats: 0 }] }, { 'x-role': 'customer' }],
    ['CreateHold', '10 asientos', { ...validHold, segments: [{ ...segment, seats: 10 }] }, { 'x-role': 'customer' }],
    ['CreateHold', 'cabina inv?lida', { ...validHold, segments: [{ ...segment, cabinClass: 'LUXURY' }] }, { 'x-role': 'customer' }],
    ['CreateHold', 'sin segmentos', { ...validHold, segments: [] }, { 'x-role': 'customer' }],
    ['CreateHold', 'idempotency key vac?a', { ...validHold, idempotencyKey: '' }, { 'x-role': 'customer' }],
    ['CreateHold', 'owner demasiado largo', { ...validHold, ownerId: 'o'.repeat(200) }, { 'x-role': 'customer' }],
    ['CreateHold', 'expiresAt no ISO', { ...validHold, expiresAt: 'ma?ana' }, { 'x-role': 'customer' }],
    ['GetHold', 'hold id no uuid', { holdId: 'x', ownerId: 'o1' }, { 'x-role': 'customer' }],
    ['GetHold', 'sin owner', { holdId: uuid(), ownerId: '' }, { 'x-role': 'customer' }],
    ['ReleaseHold', 'hold id no uuid', { holdId: 'x', ownerId: 'o1' }, { 'x-role': 'customer' }],
    ['ConsumeHold', 'hold id no uuid', { holdId: 'x', ownerId: 'o1', reservationId: uuid() }, { 'x-role': 'customer' }],
    ['ConsumeHold', 'reservation id no uuid', { holdId: uuid(), ownerId: 'o1', reservationId: 'r' }, { 'x-role': 'customer' }],
    ['ConsumeHold', 'sin reservation id', { holdId: uuid(), ownerId: 'o1' }, { 'x-role': 'customer' }],
    ['ReleaseReservedInventory', 'booking id no uuid', { bookingId: 'x', ownerId: 'o1' }, { 'x-role': 'customer' }]
  ];

  it.each(cases)('%s: %s ? INVALID_ARGUMENT', async (method, _label, request, meta) => {
    await expect(h.call(method, request, meta)).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });
});

describe('INV-SEC-01 campos desconocidos (use cases con esquemas estrictos)', () => {
  it('rechaza campos extra en el nivel superior y en objetos anidados', async () => {
    const { HoldUseCases } = await import('../../src/application/hold-use-cases');
    const holds = new HoldUseCases(null as never, null as never, { now: () => new Date() }, { holdTtlMinutes: 20, airlineCode: 'FP' });
    const ctx = { correlationId: 'c', role: 'customer' };
    await expect(holds.create(ctx, { ...validHold, extra: 1 })).rejects.toMatchObject({ error: { code: 3 } });
    await expect(holds.create(ctx, { ...validHold, segments: [{ ...segment, extra: 1 }] })).rejects.toMatchObject({ error: { code: 3 } });
  });
});

describe('INV-SEC-02/03 autenticaci?n, owner y roles', () => {
  let h: Harness = undefined as never;
  beforeAll(async () => { h = await startHarness(); await cleanup(h.prisma); });
  afterAll(async () => {
    if (!h) return;
    try { await cleanup(h.prisma); } finally { await h.close(); }
  });

  it('INV-SEC-02: Get/Release/Consume de un hold ajeno ? NOT_FOUND y el hold queda intacto', async () => {
    const flight = await createFlight(h, 3);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 2));
    const intruder = { holdId: hold.holdId, ownerId: ownerId(), reservationId: uuid() };
    for (const method of ['GetHold', 'ReleaseHold', 'ConsumeHold']) {
      await expect(h.call(method, intruder)).rejects.toMatchObject({ code: 5, details: 'NOT_FOUND' });
    }
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 2, sold: 0 });
    expect((await h.call<{ status: string }>('GetHold', { holdId: hold.holdId, ownerId: owner })).status).toBe('HELD');
  });

  it('INV-SEC-02: ReleaseReservedInventory de otro owner no restituye nada', async () => {
    const flight = await createFlight(h, 3);
    const owner = ownerId();
    const hold = await h.call<{ holdId: string }>('CreateHold', holdRequest(owner, flight, 2));
    const reservationId = uuid();
    await h.call('ConsumeHold', { holdId: hold.holdId, ownerId: owner, reservationId });
    await h.call('ReleaseReservedInventory', { bookingId: reservationId, ownerId: ownerId() });
    expect(await capacity(h.prisma, flight)).toMatchObject({ held: 0, sold: 2 });
  });

  it('INV-SEC-02: el owner del cuerpo debe coincidir con x-owner-id del Gateway', async () => {
    const flight = await createFlight(h, 3);
    await expect(
      h.call('CreateHold', holdRequest(ownerId(), flight, 1), { 'x-role': 'customer', 'x-owner-id': ownerId() })
    ).rejects.toMatchObject({ code: 7 });
  });

  it('INV-SEC-03: sin llave interna o con una incorrecta ? UNAUTHENTICATED', async () => {
    const reqs: [string, unknown][] = [
      ['QueryAvailability', { origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01', passengers: mix }],
      ['CreateHold', validHold],
      ['ExpireHolds', {}]
    ];
    for (const [method, request] of reqs) {
      await expect(h.call(method, request, null)).rejects.toMatchObject({ code: 16, details: 'UNAUTHENTICATED' });
    }
    const wrong = h.call('GetHold', { holdId: uuid(), ownerId: 'o' }, { 'x-internal-key': 'x'.repeat(40) });
    await expect(wrong).rejects.toMatchObject({ code: 16 });
  });

  it('INV-SEC-03: RPCs administrativos con rol customer ? PERMISSION_DENIED', async () => {
    const upsert = { flightNumber: 'Z41', departureIata: 'UIO', arrivalIata: 'GYE', departureAt: '2030-01-01T10:00:00Z', arrivalAt: '2030-01-01T11:00:00Z', cabins: [{ cabinClass: 'ECONOMY', capacity: 5 }] };
    for (const role of ['customer', 'partner']) {
      const meta = { 'x-role': role };
      await expect(h.call('UpsertFlightInstance', upsert, meta)).rejects.toMatchObject({ code: 7, details: 'PERMISSION_DENIED' });
      await expect(h.call('CloseFlightInstance', { flightInstanceId: uuid() }, meta)).rejects.toMatchObject({ code: 7 });
      await expect(h.call('ExpireHolds', {}, meta)).rejects.toMatchObject({ code: 7 });
    }
    await expect(h.call('ExpireHolds', {}, ADMIN)).rejects.toMatchObject({ code: 7 });
    await expect(h.call('UpsertFlightInstance', upsert, null)).rejects.toMatchObject({ code: 16 });
    expect((await h.call<{ expiredCount: number }>('ExpireHolds', {}, SYSTEM)).expiredCount).toBeGreaterThanOrEqual(0);
  });
});

describe('INV-SEC-03 errores internos y logs', () => {
  it('un fallo interno no filtra mensajes, stack ni datos de conexi?n', async () => {
    const broken = new PrismaClient({ datasourceUrl: 'postgresql://secretuser:secretpass@127.0.0.1:1/none?schema=inventory&connect_timeout=1' });
    const h = await startHarness({ prisma: broken });
    try {
      const err = await h.call('GetFlightInstance', { flightInstanceId: uuid() }).catch((e: Error & { code: number; details: string }) => e);
      expect(err).toMatchObject({ code: 13, details: 'INTERNAL_ERROR' });
      const text = JSON.stringify([(err as Error).message, (err as Error).stack?.split('\n').slice(0, 1)]);
      expect(text).not.toMatch(/secret|127\.0\.0\.1|prisma|PrismaClient|\sat\s/i);
      expect(h.logs.join('')).not.toMatch(/secretpass/);
    } finally {
      await h.close();
    }
  });

  it('el logger redacta documentNumber, email, phone, nombres, authorization, secret y paymentReference', () => {
    const lines: string[] = [];
    const log = createLogger(new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } }));
    log.info({
      passenger: { documentNumber: 'DOC123456', email: 'ana@example.com', phone: '+593999', firstName: 'Ana', lastName: 'P?rez' },
      authorization: 'Bearer abc', secret: 'whsec_1', request: { paymentReference: 'pay_ok_1', email: 'a@b.co' }
    }, 'operaci?n con PII');
    const out = lines.join('');
    for (const value of ['DOC123456', 'ana@example.com', '+593999', 'Ana', 'P?rez', 'Bearer abc', 'whsec_1', 'pay_ok_1', 'a@b.co']) {
      expect(out).not.toContain(value);
    }
    expect(out).toContain('[REDACTED]');
  });
});
