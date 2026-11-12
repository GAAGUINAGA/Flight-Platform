import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { DomainError } from '@flight-platform/shared';
import { CreateReservation, CreateReservationInput } from '../../src/application/create-reservation';
import { FakeAncillariesPort, FakeEventPublisher, FakeInventoryPort, FakePaymentVerifier, FakePricingPort, FakeTicketingPort } from '../../src/infrastructure/clients/fakes';
import { Prisma, PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaReservationStore } from '../../src/infrastructure/persistence/prisma-reservation-store';

// H1-H3 (audit-20/21, ADR-F12c-03): Reservation aplica los topes del canal WEB en la misma transacción corta que inserta la reserva
// (candado transaccional por dueño). La carrera la decide Postgres: se prueba con varias "instancias" (cada CreateReservation serializa solo las suyas).
class FailingTicketing extends FakeTicketingPort { override async issueTickets(): Promise<never> { throw new DomainError('TICKET_ISSUANCE_FAILED'); } }
class FailingAllowance extends FakeAncillariesPort { override async registerBaggageAllowance(): Promise<void> { throw new DomainError('PNR_CREATION_FAILED'); } }
const ITINERARY = '00000000-0000-4000-8000-000000000301';
const LIMIT_CODES = ['WEB_ACTIVE_LIMIT_EXCEEDED', 'WEB_PASSENGERS_LIMIT_EXCEEDED'];

describe('F12c / ADR-F12c-03: topes del canal WEB aplicados por Reservation en Postgres', () => {
  let prisma: PrismaClient; let store: PrismaReservationStore; const run = `wl-${randomUUID().slice(0, 8)}`; let counter = 0;
  beforeAll(async () => {
    const env = join(process.cwd(), 'microservices', 'reservation-service', '.env'); if (!process.env.DATABASE_URL && existsSync(env)) process.loadEnvFile(env);
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Reservation integration tests; set it or provide microservices/reservation-service/.env');
    prisma = new PrismaClient(); await prisma.$connect(); store = new PrismaReservationStore(prisma);
  });
  afterAll(async () => { try { if (prisma) await prisma.reservation.deleteMany({ where: { ownerId: { startsWith: run } } }); } finally { await prisma?.$disconnect(); } });

  const owner = () => { counter += 1; return `${run}-${counter}`; };
  /** Una "instancia" de Reservation: su propio caso de uso (y su propia serie interna) sobre la misma base. */
  const instance = (ownerId: string, holds: string[], pax: number, parts: { ticketing?: FakeTicketingPort; ancillaries?: FakeAncillariesPort } = {}) => {
    const pricing = new FakePricingPort();
    for (const holdId of holds) pricing.holds.set(holdId, { holdId, ownerId, status: 'HELD', expiresAt: '2099-01-01T00:00:00.000Z', lockedPrice: { currency: 'USD', total: '1.00' }, passengersBreakdown: { adults: pax, youths: 0, children: 0, infants: 0 }, itineraries: [{ itineraryId: ITINERARY, pricingOptions: [{ baggageAllowance: { checkedBaggageIncluded: 0 } }] }] });
    return new CreateReservation(store, pricing, new FakePaymentVerifier(), parts.ancillaries ?? new FakeAncillariesPort(), new FakeInventoryPort(), parts.ticketing ?? new FakeTicketingPort(), new FakeEventPublisher());
  };
  const request = (ownerId: string, pax: number, limits: { active: number; day: number }, extra: Partial<CreateReservationInput> = {}): { holdId: string; input: CreateReservationInput } => {
    const holdId = randomUUID();
    return { holdId, input: { ownerId, holdId, passengers: Array.from({ length: pax }, () => ({ passengerId: randomUUID(), passengerType: 'ADULT', birthDate: '1990-01-01' })), payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID(), paymentChannel: 'WEB', deferIssuanceFailure: true, webMaxActiveBookings: limits.active, webMaxPassengersPerDay: limits.day, ...extra } };
  };
  const book = (ownerId: string, pax: number, limits: { active: number; day: number }, extra: Partial<CreateReservationInput> = {}, parts: Parameters<typeof instance>[3] = {}) => { const { holdId, input } = request(ownerId, pax, limits, extra); return instance(ownerId, [holdId], pax, parts).execute(input); };
  const code = (result: PromiseSettledResult<unknown>) => result.status === 'rejected' ? (result.reason as DomainError).code : 'OK';
  const active = (ownerId: string) => prisma.reservation.count({ where: { ownerId, status: { notIn: ['CANCELLED', 'FAILED'] } } });

  it.each([2, 5, 10])('RSV-WEBLIM-01: %i creaciones simultáneas del mismo dueño (instancias distintas) con tope de 3 activas → solo pasan las que caben', async (n) => {
    const ownerId = owner(); const results = await Promise.allSettled(Array.from({ length: n }, () => book(ownerId, 1, { active: 3, day: 99 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(Math.min(n, 3));
    for (const r of results) if (r.status === 'rejected') expect(code(r)).toBe('WEB_ACTIVE_LIMIT_EXCEEDED');
    expect(await active(ownerId)).toBe(Math.min(n, 3));
  }, 60_000);
  it('RSV-WEBLIM-02: con tope 1 nunca quedan 2 activas, ni repitiendo la carrera', async () => {
    for (let round = 0; round < 5; round += 1) {
      const ownerId = owner(); const results = await Promise.allSettled(Array.from({ length: 6 }, () => book(ownerId, 1, { active: 1, day: 99 })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(await active(ownerId)).toBe(1);
    }
  }, 120_000);
  it('RSV-WEBLIM-03: pasajeros por día simultáneos (2 por reserva, tope 5) → caben 2 reservas (4 pasajeros)', async () => {
    const ownerId = owner(); const results = await Promise.allSettled(Array.from({ length: 6 }, () => book(ownerId, 2, { active: 99, day: 5 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2); for (const r of results) if (r.status === 'rejected') expect(code(r)).toBe('WEB_PASSENGERS_LIMIT_EXCEEDED');
    expect(await prisma.reservationPassenger.count({ where: { reservation: { ownerId } } })).toBe(4);
  }, 60_000);
  it('RSV-WEBLIM-04: el candado es por dueño: uno retenido no bloquea a otro dueño, pero sí a su propio dueño hasta que termina la transacción', async () => {
    const holder = owner(); const other = owner(); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); let locked!: () => void; const hasLock = new Promise<void>((resolve) => { locked = resolve; });
    const holding = prisma.$transaction(async (tx) => { await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation-web-limits:${holder}`}, 0))`); locked(); await gate; }, { timeout: 30_000 });
    await hasLock; const started = Date.now();
    await book(other, 1, { active: 5, day: 99 }); expect(Date.now() - started).toBeLessThan(5_000); // otro dueño: no espera
    let finished = false; const same = book(holder, 1, { active: 5, day: 99 }).then(() => { finished = true; });
    await sleep(1_000); expect(finished).toBe(false); // el mismo dueño espera el candado
    release(); await holding; await same; expect(finished).toBe(true); expect(await active(holder)).toBe(1);
  }, 60_000);
  it('RSV-WEBLIM-05: cancelar libera el lugar en activas, pero los pasajeros del día siguen contando', async () => {
    const ownerId = owner(); const limits = { active: 2, day: 3 };
    const a = await book(ownerId, 1, limits); await book(ownerId, 1, limits);
    expect(code((await Promise.allSettled([book(ownerId, 1, limits)]))[0])).toBe('WEB_ACTIVE_LIMIT_EXCEEDED');
    await store.update({ ...a, status: 'CANCELLED' }); // la cancelación libera su lugar en activas
    await book(ownerId, 1, limits); // 3.ª reserva del día (la cancelada cuenta)
    const cancelled = await prisma.reservation.findFirst({ where: { ownerId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } }); await store.update({ ...(await store.findById(ownerId, cancelled!.id))!, status: 'CANCELLED' });
    expect(await active(ownerId)).toBe(1); // hay lugar en activas…
    expect(code((await Promise.allSettled([book(ownerId, 1, limits)]))[0])).toBe('WEB_PASSENGERS_LIMIT_EXCEEDED'); // …pero el día ya sumó 3 pasajeros aunque se cancelaron
  }, 60_000);
  it('RSV-WEBLIM-06: una reserva FAILED no ocupa lugar ni cuenta pasajeros del día (nunca se vendió)', async () => {
    const ownerId = owner(); const limits = { active: 1, day: 1 };
    await expect(book(ownerId, 1, limits, {}, { ancillaries: new FailingAllowance() })).rejects.toBeDefined(); // se insertó y falló: queda FAILED
    expect((await prisma.reservation.findMany({ where: { ownerId } })).map((r) => r.status)).toEqual(['FAILED']);
    await expect(book(ownerId, 1, limits)).resolves.toBeDefined();
  }, 60_000);
  it('RSV-WEBLIM-07: un error DESPUÉS de insertar (emisión de boletos fallida, reserva en TICKET_ISSUING) no libera el lugar: el siguiente se rechaza', async () => {
    const ownerId = owner(); const limits = { active: 1, day: 99 };
    const created = await book(ownerId, 1, limits, {}, { ticketing: new FailingTicketing() }); expect(created.status).toBe('TICKET_ISSUING');
    expect(code((await Promise.allSettled([book(ownerId, 1, limits)]))[0])).toBe('WEB_ACTIVE_LIMIT_EXCEEDED'); expect(await active(ownerId)).toBe(1);
  }, 60_000);
  it('RSV-WEBLIM-08: respuesta perdida (el cliente reintenta la misma Idempotency-Key): no crea otra reserva ni se rechaza por el tope, aunque esté lleno', async () => {
    const ownerId = owner(); const limits = { active: 1, day: 1 }; const { holdId, input } = request(ownerId, 1, limits);
    const first = await instance(ownerId, [holdId], 1).execute(input);
    const retries = await Promise.all([instance(ownerId, [holdId], 1).execute(input), instance(ownerId, [holdId], 1).execute(input)]);
    expect(new Set([first.id, ...retries.map((r) => r.id)]).size).toBe(1); expect(await prisma.reservation.count({ where: { ownerId } })).toBe(1);
    expect(code((await Promise.allSettled([book(ownerId, 1, limits)]))[0])).toBe('WEB_ACTIVE_LIMIT_EXCEEDED'); // otra petición distinta sí cae en el tope
  }, 60_000);
  it('RSV-WEBLIM-09: el canal BOOKING (socios) y las peticiones sin topes no tienen límite', async () => {
    const ownerId = owner(); const results = await Promise.allSettled(Array.from({ length: 5 }, () => book(ownerId, 1, { active: 1, day: 1 }, { paymentChannel: 'BOOKING', webMaxActiveBookings: undefined, webMaxPassengersPerDay: undefined })));
    expect(results.map(code)).toEqual(['OK', 'OK', 'OK', 'OK', 'OK']); expect(LIMIT_CODES).toHaveLength(2);
  }, 60_000);
});
