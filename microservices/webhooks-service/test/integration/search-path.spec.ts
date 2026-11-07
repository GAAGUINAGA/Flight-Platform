import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { pinPublicSearchPath, serviceDatabaseUrl, singleConnectionUrl } from '../../../../test-support/search-path';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaWebhookStore } from '../../src/infrastructure/persistence/prisma-webhook-store';

// ADR-F12b1-fix-01: claimPending (FOR UPDATE SKIP LOCKED sobre deliveries) se califica con el esquema.
describe('ADR-F12b1-fix-01: consultas a mano de Webhooks con search_path = public', () => {
  let prisma: PrismaClient; let store: PrismaWebhookStore;
  const ownerId = `webhooks-sp-${randomUUID()}`; const eventId = randomUUID();
  // Fecha lejana en el pasado: solo reclama la entrega de esta prueba, no las de otros datos locales.
  const now = new Date('1990-01-01T00:00:00.000Z');
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: singleConnectionUrl(serviceDatabaseUrl('microservices/webhooks-service')) });
    await prisma.$connect();
    store = new PrismaWebhookStore(prisma);
    await pinPublicSearchPath(prisma, 'webhooks', 'deliveries');
  }, 60_000);
  afterAll(async () => {
    try { if (prisma) { await prisma.delivery.deleteMany({ where: { eventId } }); await prisma.event.deleteMany({ where: { eventId } }); await prisma.subscription.deleteMany({ where: { ownerId } }); } } finally { await prisma?.$disconnect(); }
  });

  it('claimPending reclama la entrega pendiente sin depender del search_path', async () => {
    const subscription = await store.createSubscription({ id: randomUUID(), ownerId, url: 'https://hooks.example.test/sp', events: ['booking.confirmed'], encryptedSecret: 'enc', active: true });
    await store.recordEvent({ eventId, ownerId, eventType: 'booking.confirmed', occurredAt: now, apiVersion: 'v1', data: {} });
    await store.createDeliveries(eventId, { eventId, eventType: 'booking.confirmed', occurredAt: now.toISOString(), apiVersion: 'v1' }, [subscription.id], now);
    const claimed = await store.claimPending(now, 100, 10_000);
    expect(claimed.map((d) => d.eventId)).toEqual([eventId]);
    expect((await prisma.delivery.findFirstOrThrow({ where: { eventId } })).status).toBe('PROCESSING');
  });
});
