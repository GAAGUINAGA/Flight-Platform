-- F12a (ADR-F12-04): canal de verificación de pago de la reserva (BOOKING = API de pagos de Booking; NULL = verificador v1).
ALTER TABLE "reservation"."reservations" ADD COLUMN "payment_channel" VARCHAR(16);
