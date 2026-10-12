import { BookingOwnershipStore, ownershipNotFound } from '../../application/booking-ownership';
import { PrismaClient } from './prisma-client/client';

export class PrismaBookingOwnershipStore implements BookingOwnershipStore {
  constructor(private readonly prisma: PrismaClient) {}

  async claimOrAssertOwner(bookingId: string, ownerId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "booking_owners" ("booking_id", "owner_id", "updated_at")
      VALUES (${bookingId}::uuid, ${ownerId}, CURRENT_TIMESTAMP)
      ON CONFLICT ("booking_id") DO NOTHING`;
    await this.assertOwner(bookingId, ownerId);
  }

  async assertOwner(bookingId: string, ownerId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ owner_id: string }>>`
      SELECT "owner_id" FROM "booking_owners" WHERE "booking_id" = ${bookingId}::uuid`;
    if (rows[0]?.owner_id !== ownerId) ownershipNotFound();
  }
}
