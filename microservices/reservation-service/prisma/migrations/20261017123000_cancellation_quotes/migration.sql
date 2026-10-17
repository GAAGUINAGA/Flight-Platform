CREATE TABLE "reservation"."cancellation_quotes" (
  "quote_id" VARCHAR(128) NOT NULL,
  "booking_id" UUID NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL,
  "payload" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cancellation_quotes_pkey" PRIMARY KEY ("quote_id"),
  CONSTRAINT "cancellation_quotes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "reservation"."reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cancellation_quotes_booking_id_owner_id_expires_at_idx" ON "reservation"."cancellation_quotes"("booking_id", "owner_id", "expires_at");
