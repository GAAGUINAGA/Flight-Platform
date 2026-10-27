-- F12a P6 (ADR-F12-10): puerta de embarque y motivo del último cambio de estado (campos aditivos y opcionales).
ALTER TABLE "operational_flights" ADD COLUMN "departure_gate" VARCHAR(16);
ALTER TABLE "operational_flights" ADD COLUMN "status_reason" VARCHAR(200);
