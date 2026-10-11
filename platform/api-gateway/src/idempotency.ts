import { createHash } from 'node:crypto';

export type IdempotencyState = 'IN_PROGRESS' | 'COMPLETED';
export interface IdempotencyRecord { ownerId: string; key: string; requestHash: string; state: IdempotencyState; response?: { status: number; body: unknown }; expiresAt: Date; }
export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  constructor(private readonly ttlHours = 24) {}
  private hash(body: unknown): string { return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex'); }
  private id(ownerId: string, key: string): string { return `${ownerId}:${key}`; }
  begin(ownerId: string, key: string, body: unknown): IdempotencyRecord | 'MISMATCH' | 'IN_PROGRESS' {
    const id = this.id(ownerId, key); const hash = this.hash(body); const previous = this.records.get(id);
    if (previous && previous.expiresAt > new Date()) {
      if (previous.requestHash !== hash) return 'MISMATCH';
      return previous.state === 'IN_PROGRESS' ? 'IN_PROGRESS' : previous;
    }
    const record: IdempotencyRecord = { ownerId, key, requestHash: hash, state: 'IN_PROGRESS', expiresAt: new Date(Date.now() + this.ttlHours * 3_600_000) };
    this.records.set(id, record); return record;
  }
  complete(record: IdempotencyRecord, status: number, body: unknown): void { record.state = 'COMPLETED'; record.response = { status, body }; }
  purge(now = new Date()): void { for (const [id, record] of this.records) if (record.expiresAt <= now) this.records.delete(id); }
}

export interface GatewayIdempotencyRecord {
  id: string;
  requestHash: string;
  responseCode: number | null;
  responseBody: unknown;
}

/** Almacén efímero para las rutas de prueba; el runtime usa Prisma. */
export class InMemoryGatewayIdempotencyStore {
  private readonly records = new Map<string, GatewayIdempotencyRecord & { ownerId: string; key: string; expiresAt: Date; status: IdempotencyState }>();
  constructor(private readonly ttlHours = 24) {}
  private hash(body: unknown): string { return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex'); }
  private mapKey(ownerId: string, key: string): string { return `${ownerId}:${key}`; }
  async begin(ownerId: string, key: string, body: unknown): Promise<GatewayIdempotencyRecord | 'MISMATCH' | 'IN_PROGRESS'> {
    const mapKey = this.mapKey(ownerId, key); const requestHash = this.hash(body); const previous = this.records.get(mapKey);
    if (previous && previous.expiresAt > new Date()) {
      if (previous.requestHash !== requestHash) return 'MISMATCH';
      return previous.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : previous;
    }
    const record = { id: mapKey, ownerId, key, requestHash, status: 'IN_PROGRESS' as const, responseCode: null, responseBody: null, expiresAt: new Date(Date.now() + this.ttlHours * 3_600_000) };
    this.records.set(mapKey, record); return record;
  }
  async complete(id: string, responseCode: number, responseBody: object): Promise<void> {
    const record = this.records.get(id); if (!record) return;
    record.status = 'COMPLETED'; record.responseCode = responseCode; record.responseBody = responseBody;
  }
}
