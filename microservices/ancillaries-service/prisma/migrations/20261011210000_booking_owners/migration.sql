CREATE TABLE "booking_owners" (
  "booking_id" UUID NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "booking_owners_pkey" PRIMARY KEY ("booking_id")
);
