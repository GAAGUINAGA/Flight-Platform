-- F12a P2/P3 (ADR-F12-01): estado propio de la fachada v2.
-- v2_booking: lo que v2 expone de una reserva y Reservation no guarda (holdId, paymentReference, salesChannel, ids de pasajero de Booking).
CREATE TABLE gateway.v2_booking (
  booking_id UUID PRIMARY KEY,
  client_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  hold_id UUID NOT NULL,
  payment_reference TEXT NOT NULL,
  sales_channel JSONB,
  passenger_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX v2_booking_client_id_idx ON gateway.v2_booking(client_id);
CREATE INDEX v2_booking_payment_reference_idx ON gateway.v2_booking(payment_reference);
CREATE INDEX v2_booking_hold_id_idx ON gateway.v2_booking(hold_id);

-- v2_processed_event: idempotencia de POST /vuelos/booking-events (id del CloudEvent de Booking).
CREATE TABLE gateway.v2_processed_event (
  client_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, event_id)
);
