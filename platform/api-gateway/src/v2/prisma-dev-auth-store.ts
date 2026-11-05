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
  /** Borra el cliente y las filas del Gateway que lo referencian por client_id (sin FK). Devuelve cuántas filas borró de cada tabla. */
  async deleteWithDependents(clientId: string): Promise<Record<string, number>> {
    const [bookings, events, agreements, clients] = await this.prisma.$transaction([
      this.prisma.v2Booking.deleteMany({ where: { clientId } }),
      this.prisma.v2ProcessedEvent.deleteMany({ where: { clientId } }),
      this.prisma.promotionAgreement.deleteMany({ where: { clientId } }),
      this.prisma.devAuthClient.deleteMany({ where: { clientId } }),
    ]);
    return { v2_booking: bookings.count, v2_processed_event: events.count, promotion_agreement: agreements.count, dev_auth_client: clients.count };
  }
}
