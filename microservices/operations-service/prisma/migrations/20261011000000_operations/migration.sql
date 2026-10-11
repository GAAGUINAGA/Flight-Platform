CREATE TABLE "operational_flights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "flight_instance_id" uuid NOT NULL UNIQUE, "flight_number" varchar(8) NOT NULL, "date" char(10) NOT NULL,
  "marketing_carrier" varchar(8) NOT NULL, "operating_carrier" varchar(8) NOT NULL, "departure_iata" char(3) NOT NULL, "arrival_iata" char(3) NOT NULL,
  "scheduled_departure_at" timestamptz NOT NULL, "scheduled_arrival_at" timestamptz NOT NULL, "aircraft" varchar(32), "status" varchar(16) NOT NULL,
  "estimated_departure_at" timestamptz, "actual_departure_at" timestamptz, "estimated_arrival_at" timestamptz, "actual_arrival_at" timestamptz,
  "departure_terminal" varchar(16), "arrival_terminal" varchar(16), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), UNIQUE("flight_number","date")
);
CREATE TABLE "operational_updates" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "operational_flight_id" uuid NOT NULL REFERENCES "operational_flights"("id") ON DELETE CASCADE, "status" varchar(16) NOT NULL, "data" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now());
CREATE INDEX "operational_updates_operational_flight_id_created_at_idx" ON "operational_updates"("operational_flight_id","created_at");
