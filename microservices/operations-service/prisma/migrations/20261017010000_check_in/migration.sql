CREATE TABLE "check_ins" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "owner_id" VARCHAR(255) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "result" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "check_ins_booking_id_key" ON "check_ins"("booking_id");
CREATE INDEX "check_ins_owner_id_booking_id_idx" ON "check_ins"("owner_id", "booking_id");

CREATE TABLE "boarding_passes" (
  "id" UUID NOT NULL,
  "check_in_id" UUID NOT NULL,
  "owner_id" VARCHAR(255) NOT NULL,
  "booking_id" UUID NOT NULL,
  "passenger_id" VARCHAR(128) NOT NULL,
  "segment_id" UUID NOT NULL,
  "seat" VARCHAR(8) NOT NULL,
  "barcode" TEXT NOT NULL,
  "barcode_type" VARCHAR(16) NOT NULL,
  "valid" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "boarding_passes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "boarding_passes_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "check_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "boarding_passes_booking_id_passenger_id_segment_id_key" ON "boarding_passes"("booking_id", "passenger_id", "segment_id");
CREATE INDEX "boarding_passes_owner_id_booking_id_idx" ON "boarding_passes"("owner_id", "booking_id");
