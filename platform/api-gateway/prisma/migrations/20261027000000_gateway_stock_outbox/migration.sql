-- F12a P5 (ADR-F12-08): cola de envíos de stock a Booking (gRPC PushStockUpdate), con reintento.
CREATE TABLE gateway.stock_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_instance_id UUID NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_outbox_status_due_at_idx ON gateway.stock_outbox(status, due_at);
