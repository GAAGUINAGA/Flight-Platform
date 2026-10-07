DROP INDEX "ticketing"."tickets_booking_id_passenger_id_key";
CREATE INDEX "tickets_booking_id_passenger_id_idx" ON "ticketing"."tickets"("booking_id", "passenger_id");
