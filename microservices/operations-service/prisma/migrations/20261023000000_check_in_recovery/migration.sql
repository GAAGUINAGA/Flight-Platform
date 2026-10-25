ALTER TABLE "check_ins" ADD COLUMN "event_published" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "check_ins_status_updated_at_idx" ON "check_ins"("status", "updated_at");
