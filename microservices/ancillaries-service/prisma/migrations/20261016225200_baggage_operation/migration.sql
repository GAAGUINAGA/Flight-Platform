ALTER TABLE "baggage_items" ADD COLUMN "operation_id" UUID, ADD COLUMN "result_total" INTEGER;
CREATE UNIQUE INDEX "baggage_items_operation_id_key" ON "baggage_items"("operation_id");
