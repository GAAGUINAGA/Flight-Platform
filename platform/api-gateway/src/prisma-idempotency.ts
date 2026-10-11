import { createHash } from 'node:crypto';
import { PrismaClient } from '../generated/prisma-client';

export interface StoredIdempotency { id: string; requestHash: string; status: string; responseCode: number | null; responseBody: unknown; }
const hash = (body: unknown): string => createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

/** Adaptador transaccional para la tabla gateway.idempotency_keys. */
export class PrismaIdempotencyStore {
  constructor(private readonly prisma: PrismaClient, private readonly ttlHours = 24) {}
  async begin(ownerId: string, key: string, body: unknown): Promise<StoredIdempotency | 'MISMATCH' | 'IN_PROGRESS'> {
    const requestHash = hash(body);
    try {
      const created = await this.prisma.idempotencyKey.create({ data: { ownerId, key, requestHash, status: 'IN_PROGRESS', expiresAt: new Date(Date.now() + this.ttlHours * 3_600_000) } });
      return created;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'P2002') throw error;
      const previous = await this.prisma.idempotencyKey.findUnique({ where: { ownerId_key: { ownerId, key } } });
      if (!previous || previous.expiresAt <= new Date()) {
        if (previous) await this.prisma.idempotencyKey.delete({ where: { id: previous.id } });
        return this.begin(ownerId, key, body);
      }
      if (previous.requestHash !== requestHash) return 'MISMATCH';
      return previous.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : previous;
    }
  }
  async complete(id: string, status: number, body: object): Promise<void> { await this.prisma.idempotencyKey.update({ where: { id }, data: { status: 'COMPLETED', responseCode: status, responseBody: body } }); }
}
