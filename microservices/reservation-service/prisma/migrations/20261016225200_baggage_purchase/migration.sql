DROP INDEX "payment_usages_reservation_id_key";
CREATE TABLE "baggage_purchases" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "payment_reference" VARCHAR(255) NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "response" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "baggage_purchases_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "baggage_purchases_owner_id_idempotency_key_key" ON "baggage_purchases"("owner_id", "idempotency_key");
CREATE UNIQUE INDEX "baggage_purchases_payment_reference_key" ON "baggage_purchases"("payment_reference");
CREATE INDEX "baggage_purchases_booking_id_owner_id_idx" ON "baggage_purchases"("booking_id", "owner_id");
