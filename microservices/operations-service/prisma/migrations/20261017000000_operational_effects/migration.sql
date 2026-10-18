ALTER TABLE "operational_flights"
  ADD COLUMN "cancellation_closed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancellation_notified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notified_departure_at" TIMESTAMPTZ(3);

UPDATE "operational_flights"
SET "cancellation_closed" = ("status" = 'CANCELLED'),
    "cancellation_notified" = ("status" = 'CANCELLED'),
    "notified_departure_at" = "estimated_departure_at";
