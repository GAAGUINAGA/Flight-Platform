-- F12a (ADR-F12-03): suscripciones con formato de entrega v2 y almacén global de eventos para el feed de v2.
ALTER TABLE "webhooks"."subscriptions" ADD COLUMN "api_version" VARCHAR(8) NOT NULL DEFAULT '1';

CREATE TABLE "webhooks"."events" (
  "seq" BIGSERIAL NOT NULL,
  "event_id" UUID NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "api_version" VARCHAR(32) NOT NULL,
  "correlation_id" VARCHAR(100),
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "events_pkey" PRIMARY KEY ("seq"),
  CONSTRAINT "events_event_id_key" UNIQUE ("event_id")
);
CREATE INDEX "events_owner_id_seq_idx" ON "webhooks"."events"("owner_id", "seq");
