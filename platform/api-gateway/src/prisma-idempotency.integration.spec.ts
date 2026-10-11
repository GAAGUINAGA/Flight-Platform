import { PrismaClient } from '../generated/prisma-client';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PrismaIdempotencyStore } from './prisma-idempotency';

describe('GW-04 integration: idempotency_keys', () => {
  const prisma = new PrismaClient();
  const owner = `gateway-it-${Date.now()}`;
  const store = new PrismaIdempotencyStore(prisma);
  let connected = false;
  beforeAll(async () => { await prisma.$connect(); connected = true; });
  afterAll(async () => {
    if (connected) await prisma.idempotencyKey.deleteMany({ where: { ownerId: owner } });
    await prisma.$disconnect();
  });

  it('replays an identical request and permits only one concurrent claimant', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => store.begin(owner, 'same-key', { value: 1 })));
    expect(results.filter((result) => typeof result === 'object')).toHaveLength(1);
    expect(results.filter((result) => result === 'IN_PROGRESS')).toHaveLength(4);
    const first = results.find((result): result is Exclude<typeof result, string> => typeof result === 'object');
    if (!first) throw new Error('claim missing');
    await store.complete(first.id, 201, { bookingId: 'safe' });
    await expect(store.begin(owner, 'same-key', { value: 1 })).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(store.begin(owner, 'same-key', { value: 2 })).resolves.toBe('MISMATCH');
  });
});
