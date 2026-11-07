import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { pinPublicSearchPath, serviceDatabaseUrl, singleConnectionUrl } from '../../../../test-support/search-path';
import { PrismaClient } from '../../generated/prisma-client';
import { PrismaSchedulerStore } from '../../src/scheduler-store';

// ADR-F12b1-fix-01: el candado del scheduler (scheduler_locks) se califica con el esquema del gateway.
describe('ADR-F12b1-fix-01: consultas a mano del gateway con search_path = public', () => {
  let prisma: PrismaClient; let store: PrismaSchedulerStore;
  const task = `sp-task-${randomUUID()}`;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: singleConnectionUrl(serviceDatabaseUrl('platform/api-gateway')) });
    await prisma.$connect();
    store = new PrismaSchedulerStore(prisma);
    await pinPublicSearchPath(prisma, 'gateway', 'scheduler_locks');
  }, 60_000);
  afterAll(async () => {
    try { if (prisma) await prisma.schedulerLock.deleteMany({ where: { task } }); } finally { await prisma?.$disconnect(); }
  });

  it('acquire toma el candado una sola vez sin depender del search_path', async () => {
    const now = new Date(); const until = new Date(now.getTime() + 60_000);
    expect(await store.acquire(task, now, until)).toBe(true);
    expect(await store.acquire(task, now, until)).toBe(false);
    await store.release(task);
    expect(await store.acquire(task, new Date(now.getTime() + 1_000), until)).toBe(true);
  });
});
