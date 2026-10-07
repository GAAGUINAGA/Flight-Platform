-- AlterTable
ALTER TABLE "holds" ADD COLUMN "reservation_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "reserved_inventory" ADD COLUMN "reservation_id" VARCHAR(128);

-- CreateIndex
CREATE INDEX "reserved_inventory_reservation_id_owner_id_idx" ON "reserved_inventory"("reservation_id", "owner_id");
