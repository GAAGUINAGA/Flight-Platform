import type { PrismaClient } from '../../generated/prisma-client';
import type { DevAuthClientRecord, DevAuthClientStore } from './dev-auth';

/** Adaptador de gateway.dev_auth_client. Solo guarda el hash del secreto (scrypt), nunca el secreto. */
export class PrismaDevAuthClientStore implements DevAuthClientStore {
  constructor(private readonly prisma: PrismaClient) {}
  async find(clientId: string): Promise<DevAuthClientRecord | null> {
    const row = await this.prisma.devAuthClient.findUnique({ where: { clientId } });
    return row ? { clientId: row.clientId, secretHash: row.secretHash, scopes: row.scopes, active: row.active, name: row.name ?? undefined } : null;
  }
  async create(record: DevAuthClientRecord): Promise<void> { await this.prisma.devAuthClient.create({ data: { clientId: record.clientId, secretHash: record.secretHash, scopes: record.scopes, active: record.active, name: record.name } }); }
  async setActive(clientId: string, active: boolean): Promise<void> { await this.prisma.devAuthClient.update({ where: { clientId }, data: { active } }); }
}
