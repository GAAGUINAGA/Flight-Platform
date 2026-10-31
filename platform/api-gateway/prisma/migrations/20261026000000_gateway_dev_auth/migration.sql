CREATE TABLE gateway.dev_auth_client (
  client_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
