-- ADR-F12b-04/06: outbox de eventos del ESB. Solo objetos dentro del esquema "esb" (lo crea el humano, infra/db/roles.sql).
CREATE TABLE "esb"."outbox_events" (
  "seq" BIGSERIAL NOT NULL,
  "event_id" UUID NOT NULL,
  "routing_key" VARCHAR(64) NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL,
  "envelope" JSONB NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(3) NOT NULL,
  "locked_until" TIMESTAMPTZ(3),
  "last_error" VARCHAR(32),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("seq")
);
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "esb"."outbox_events"("event_id");
CREATE INDEX "outbox_events_status_available_at_seq_idx" ON "esb"."outbox_events"("status", "available_at", "seq");
CREATE INDEX "outbox_events_status_published_at_idx" ON "esb"."outbox_events"("status", "published_at");
