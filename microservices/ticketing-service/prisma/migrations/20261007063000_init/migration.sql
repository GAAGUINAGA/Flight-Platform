CREATE TABLE "tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "booking_id" UUID NOT NULL,
  "owner_id" VARCHAR(128) NOT NULL, "passenger_id" VARCHAR(128) NOT NULL,
  "e_ticket_number" VARCHAR(13), "status" VARCHAR(16) NOT NULL,
  "issued_at" TIMESTAMPTZ(3), "failure_reason" VARCHAR(128),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tickets_status_chk" CHECK ("status" IN ('PENDING','ISSUING','ISSUED','FAILED','VOIDED','REFUNDED'))
);
CREATE TABLE "ticket_coupons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ticket_id" UUID NOT NULL,
  "segment_id" VARCHAR(128) NOT NULL, "coupon_number" VARCHAR(20), "status" VARCHAR(16) NOT NULL,
  CONSTRAINT "ticket_coupons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_coupons_status_chk" CHECK ("status" IN ('PENDING','ISSUED','FAILED'))
);
CREATE TABLE "issuance_requests" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "booking_id" UUID NOT NULL, "request_id" VARCHAR(128) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "issuance_requests_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ticket_sequences" ("prefix" CHAR(3) NOT NULL, "value" BIGINT NOT NULL DEFAULT 0, CONSTRAINT "ticket_sequences_pkey" PRIMARY KEY ("prefix"));
CREATE UNIQUE INDEX "tickets_e_ticket_number_key" ON "tickets"("e_ticket_number");
CREATE UNIQUE INDEX "tickets_booking_id_passenger_id_key" ON "tickets"("booking_id","passenger_id");
CREATE INDEX "tickets_booking_id_owner_id_idx" ON "tickets"("booking_id","owner_id");
CREATE UNIQUE INDEX "ticket_coupons_coupon_number_key" ON "ticket_coupons"("coupon_number");
CREATE UNIQUE INDEX "ticket_coupons_ticket_id_segment_id_key" ON "ticket_coupons"("ticket_id","segment_id");
CREATE INDEX "ticket_coupons_ticket_id_idx" ON "ticket_coupons"("ticket_id");
CREATE UNIQUE INDEX "issuance_requests_booking_id_request_id_key" ON "issuance_requests"("booking_id","request_id");
ALTER TABLE "ticket_coupons" ADD CONSTRAINT "ticket_coupons_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE;
