CREATE TABLE "seat_layouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aircraft" VARCHAR(32) NOT NULL,
  "cabin_class" VARCHAR(32) NOT NULL,
  "seat_number" VARCHAR(4) NOT NULL,
  "row_number" INTEGER NOT NULL,
  "characteristics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "is_emergency_exit" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seat_layouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seat_layouts_aircraft_seat_number_key" ON "seat_layouts"("aircraft", "seat_number");
CREATE INDEX "seat_layouts_aircraft_cabin_class_row_number_idx" ON "seat_layouts"("aircraft", "cabin_class", "row_number");

CREATE TABLE "seat_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "booking_id" UUID NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL,
  "passenger_id" UUID NOT NULL,
  "segment_id" UUID NOT NULL,
  "flight_instance_id" UUID NOT NULL,
  "seat_number" VARCHAR(4) NOT NULL,
  "cabin_class" VARCHAR(32) NOT NULL,
  "passenger_type" VARCHAR(16) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seat_assignments_booking_id_passenger_id_segment_id_key" ON "seat_assignments"("booking_id", "passenger_id", "segment_id");
CREATE INDEX "seat_assignments_booking_id_owner_id_idx" ON "seat_assignments"("booking_id", "owner_id");
CREATE INDEX "seat_assignments_flight_instance_id_seat_number_idx" ON "seat_assignments"("flight_instance_id", "seat_number");
CREATE UNIQUE INDEX "seat_assignments_active_flight_seat_key" ON "seat_assignments"("flight_instance_id", "seat_number") WHERE "status" <> 'RELEASED';

CREATE TABLE "baggage_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "booking_id" UUID NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL,
  "passenger_id" UUID,
  "itinerary_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "baggage_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "baggage_items_booking_id_owner_id_idx" ON "baggage_items"("booking_id", "owner_id");
CREATE INDEX "baggage_items_booking_id_passenger_id_itinerary_id_idx" ON "baggage_items"("booking_id", "passenger_id", "itinerary_id");
