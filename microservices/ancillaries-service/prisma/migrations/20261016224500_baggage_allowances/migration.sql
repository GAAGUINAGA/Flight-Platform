CREATE TABLE "baggage_allowances" (
    "booking_id" UUID NOT NULL,
    "owner_id" VARCHAR(128) NOT NULL,
    "passenger_id" UUID NOT NULL,
    "itinerary_id" UUID NOT NULL,
    "checked_baggage_included" INTEGER NOT NULL CHECK ("checked_baggage_included" >= 0),
    CONSTRAINT "baggage_allowances_pkey" PRIMARY KEY ("booking_id", "passenger_id", "itinerary_id")
);
CREATE INDEX "baggage_allowances_booking_id_owner_id_idx" ON "baggage_allowances"("booking_id", "owner_id");
