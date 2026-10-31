-- F12a-2 D (ADR-F12a2-02): cabina del pasajero tomada de la reserva al hacer check-in. Nullable: los check-ins anteriores quedan sin cabina.
ALTER TABLE "boarding_passes" ADD COLUMN "cabin_class" VARCHAR(24);
CREATE INDEX "boarding_passes_segment_id_idx" ON "boarding_passes"("segment_id");
