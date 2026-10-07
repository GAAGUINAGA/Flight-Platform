CREATE TABLE "webhooks"."subscriptions" (
  "id" UUID NOT NULL, "owner_id" VARCHAR(128) NOT NULL, "url" VARCHAR(2048) NOT NULL,
  "events" TEXT[] NOT NULL, "encrypted_secret" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subscriptions_owner_id_active_idx" ON "webhooks"."subscriptions"("owner_id", "active");
CREATE TABLE "webhooks"."deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "event_id" UUID NOT NULL, "subscription_id" UUID NOT NULL,
  "payload" JSONB NOT NULL, "status" VARCHAR(16) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL, "last_attempt_at" TIMESTAMPTZ(3), "delivered_at" TIMESTAMPTZ(3),
  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"), CONSTRAINT "deliveries_event_id_subscription_id_key" UNIQUE ("event_id", "subscription_id"),
  CONSTRAINT "deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhooks"."subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "deliveries_status_next_attempt_at_idx" ON "webhooks"."deliveries"("status", "next_attempt_at");
