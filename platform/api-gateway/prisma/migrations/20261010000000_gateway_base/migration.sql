CREATE TABLE gateway.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  response_code INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT idempotency_keys_owner_id_key_key UNIQUE (owner_id, key)
);
CREATE INDEX idempotency_keys_expires_at_idx ON gateway.idempotency_keys(expires_at);
