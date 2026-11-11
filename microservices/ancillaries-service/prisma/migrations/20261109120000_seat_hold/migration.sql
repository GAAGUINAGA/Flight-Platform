-- Asientos apartados por un hold (ADR-F12d-01). Aditiva: columnas nulas; las filas existentes no cambian.
-- Todo objeto va calificado con el esquema "ancillaries": no depende del search_path (ADR-F12b1fix-01).
-- hold_id: hold dueño de la fila (solo filas HELD, y la fila del hold ya convertida a reserva).
-- hold_expires_at: vencimiento del hold; una fila HELD vencida cuenta como libre.
-- converted_booking_id: reserva a la que pasó el asiento del hold (permite devolverlo al hold si la reserva se compensa).
ALTER TABLE "ancillaries"."seat_assignments" ADD COLUMN "hold_id" UUID, ADD COLUMN "hold_expires_at" TIMESTAMPTZ(3), ADD COLUMN "converted_booking_id" UUID;
-- El nombre del índice no admite esquema: se crea en el de su tabla.
CREATE INDEX "seat_assignments_hold_id_idx" ON "ancillaries"."seat_assignments"("hold_id");
