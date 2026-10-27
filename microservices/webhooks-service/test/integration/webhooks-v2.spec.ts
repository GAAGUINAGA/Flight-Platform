/* global __dirname, afterAll, beforeAll, Buffer */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { WebhookUseCases } from '../../src/application/webhook-use-cases';
import { UrlPolicy } from '../../src/application/ports';
import { PrismaWebhookStore } from '../../src/infrastructure/persistence/prisma-webhook-store';
import { AesGcmCipher } from '../../src/infrastructure/security/webhook-security';

const system = { role: 'system', correlationId: 'integration-v2' };
const allow: UrlPolicy = { assertSafe: async () => undefined };
// Prefijo propio del escenario: la limpieza solo toca lo que esta ejecución creó.
const run = `whv2-${randomUUID().slice(0, 8)}`;

describe('WHK-V2 integración (Postgres): enrutado por cliente y almacén de eventos', () => {
  let prisma: PrismaClient; let store: PrismaWebhookStore; let useCases: WebhookUseCases; const deliveries: Array<{ body: string; headers: Record<string, string> }> = [];
  const clientA = `${run}-a`; const clientB = `${run}-b`;
  beforeAll(async () => {
    const env = join(__dirname, '..', '..', '.env'); if (existsSync(env)) process.loadEnvFile(env);
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for webhooks integration tests');
    prisma = new PrismaClient(); await prisma.$connect(); store = new PrismaWebhookStore(prisma);
    useCases = new WebhookUseCases(store, allow, new AesGcmCipher(Buffer.alloc(32, 5).toString('base64')), { post: async (_url, body, headers) => { deliveries.push({ body, headers }); return 204; } }, { timeoutMs: 5000, backoffMinutes: [1], production: false, sourceCode: 'gabatair' }, () => new Date(), store);
  }, 60_000);
  afterAll(async () => { if (prisma) { await prisma.event.deleteMany({ where: { ownerId: { startsWith: run } } }); await prisma.subscription.deleteMany({ where: { ownerId: { startsWith: run } } }); await prisma.$disconnect(); } });

  it('WHK-V2-IT-01: la suscripción v2 se guarda con api_version 2 y la v1 con 1', async () => {
    const v2 = await useCases.create(system, { ownerId: `${run}-sub2`, url: 'https://hooks.example.test/v2', events: ['booking.confirmed'], secret: 'integration-secret-1', apiVersion: '2' });
    const v1 = await useCases.create(system, { ownerId: `${run}-sub1`, url: 'https://hooks.example.test/v1', events: ['booking.confirmed'], secret: 'integration-secret-2' });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: v2.id } })).apiVersion).toBe('2'); expect((await prisma.subscription.findUniqueOrThrow({ where: { id: v1.id } })).apiVersion).toBe('1');
    expect(v2).toMatchObject({ active: true, createdAt: expect.any(String) }); expect(v1).not.toHaveProperty('active');
  });
  it('WHK-V2-IT-02: D1 — la suscripción del cliente recibe los eventos <clientId>~* y no los de otro cliente', async () => {
    const mine = await useCases.create(system, { ownerId: clientA, url: 'https://hooks.example.test/a', events: ['booking.confirmed'], secret: 'integration-secret-3', apiVersion: '2' });
    await useCases.create(system, { ownerId: clientB, url: 'https://hooks.example.test/b', events: ['booking.confirmed'], secret: 'integration-secret-4', apiVersion: '2' });
    const { eventId } = await useCases.publish(system, { ownerId: `${clientA}~user-7`, payload: { eventType: 'booking.confirmed', data: { bookingId: randomUUID(), status: 'CONFIRMED' } } });
    expect((await prisma.delivery.findMany({ where: { eventId } })).map((d) => d.subscriptionId)).toEqual([mine.id]);
  });
  it('WHK-V2-IT-03: el evento queda registrado con seq creciente y un reintento con el mismo eventId conserva el seq', async () => {
    const eventId = randomUUID(); const payload = { eventId, eventType: 'booking.confirmed', correlationId: 'corr-it-3', data: { bookingId: randomUUID(), dataJson: JSON.stringify({ grandTotal: { currency: 'USD', total: '5.00' } }) } };
    await useCases.publish(system, { ownerId: `${clientA}~user-8`, payload }); await useCases.publish(system, { ownerId: `${clientA}~user-8`, payload });
    const rows = await prisma.event.findMany({ where: { eventId } }); expect(rows).toHaveLength(1); expect(rows[0].correlationId).toBe('corr-it-3'); expect(rows[0].data).toMatchObject({ grandTotal: { total: '5.00' } });
    const next = await useCases.publish(system, { ownerId: `${clientA}~user-8`, payload: { eventType: 'booking.confirmed' } });
    expect((await prisma.event.findUniqueOrThrow({ where: { eventId: next.eventId } })).seq > rows[0].seq).toBe(true);
  });
  it('WHK-V2-IT-04: ListEvents devuelve solo los eventos del cliente, en orden, con total y paginación por afterSeq', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await useCases.publish(system, { ownerId: i === 1 ? clientA : `${clientA}~u${i}`, payload: { eventType: 'hold.expired', data: { holdId: randomUUID() } } })).eventId);
    await useCases.publish(system, { ownerId: `${clientB}~u`, payload: { eventType: 'hold.expired', data: { holdId: randomUUID() } } });
    const all = await useCases.listEvents(system, { ownerPrefix: clientA, eventType: 'hold.expired' }); expect(all.items.map((e) => e.eventId)).toEqual(ids); expect(all.total).toBe(3);
    const rest = await useCases.listEvents(system, { ownerPrefix: clientA, eventType: 'hold.expired', afterSeq: all.items[0].seq }); expect(rest.items.map((e) => e.eventId)).toEqual(ids.slice(1));
    expect(all.items.every((e, i) => i === 0 || e.seq > all.items[i - 1].seq)).toBe(true);
  });
  it('WHK-V2-IT-05: un prefijo que es cadena inicial de otro cliente no filtra sus eventos', async () => {
    const short = `${run}-x`; const long = `${run}-xy`;
    await useCases.publish(system, { ownerId: `${long}~u`, payload: { eventType: 'hold.expired', data: { holdId: randomUUID() } } });
    expect((await useCases.listEvents(system, { ownerPrefix: short })).items).toHaveLength(0);
  });
  it('WHK-V2-IT-06: la entrega del evento a una suscripción v2 sale como CloudEvent con id evt-vue-<seq>', async () => {
    deliveries.length = 0; const owner = `${run}-d`; await useCases.create(system, { ownerId: owner, url: 'https://hooks.example.test/d', events: ['booking.ticket_issued'], secret: 'integration-secret-6', apiVersion: '2' });
    const { eventId } = await useCases.publish(system, { ownerId: `${owner}~u`, payload: { eventType: 'booking.ticket_issued', data: { bookingId: randomUUID(), status: 'CONFIRMED' } } });
    expect(await useCases.dispatch(system, {})).toBeGreaterThanOrEqual(1);
    const seq = (await prisma.event.findUniqueOrThrow({ where: { eventId } })).seq; const sent = deliveries.map((d) => JSON.parse(d.body) as { id: string }).find((e) => e.id === `evt-vue-${String(seq).padStart(6, '0')}`);
    expect(sent).toBeDefined();
  });
});
