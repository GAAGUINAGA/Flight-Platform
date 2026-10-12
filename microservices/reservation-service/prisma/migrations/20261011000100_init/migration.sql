CREATE TABLE "reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "owner_id" VARCHAR(128) NOT NULL, "pnr" VARCHAR(6) NOT NULL,
  "status" VARCHAR(32) NOT NULL, "hold_id" UUID NOT NULL, "itineraries" JSONB NOT NULL DEFAULT '[]', "grand_total" JSONB NOT NULL,
  "payment_reference" VARCHAR(255), "idempotency_key" VARCHAR(255) NOT NULL, "saga_step" VARCHAR(64) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "reservation_passengers" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "reservation_id" UUID NOT NULL, "passenger_id" UUID NOT NULL, "data" JSONB NOT NULL, CONSTRAINT "reservation_passengers_pkey" PRIMARY KEY ("id"));
CREATE TABLE "reservation_changes" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "reservation_id" UUID NOT NULL, "changed_at" TIMESTAMPTZ(3) NOT NULL, "description" VARCHAR(255) NOT NULL, CONSTRAINT "reservation_changes_pkey" PRIMARY KEY ("id"));
CREATE TABLE "payment_usages" ("payment_reference" VARCHAR(255) NOT NULL, "reservation_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "payment_usages_pkey" PRIMARY KEY ("payment_reference"));
CREATE UNIQUE INDEX "reservations_pnr_key" ON "reservations"("pnr");
CREATE UNIQUE INDEX "reservations_owner_id_idempotency_key_key" ON "reservations"("owner_id", "idempotency_key");
CREATE INDEX "reservations_owner_id_created_at_idx" ON "reservations"("owner_id", "created_at");
CREATE UNIQUE INDEX "reservation_passengers_reservation_id_passenger_id_key" ON "reservation_passengers"("reservation_id", "passenger_id");
CREATE INDEX "reservation_changes_reservation_id_changed_at_idx" ON "reservation_changes"("reservation_id", "changed_at");
CREATE UNIQUE INDEX "payment_usages_reservation_id_key" ON "payment_usages"("reservation_id");
ALTER TABLE "reservation_passengers" ADD CONSTRAINT "reservation_passengers_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservation_changes" ADD CONSTRAINT "reservation_changes_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_usages" ADD CONSTRAINT "payment_usages_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
