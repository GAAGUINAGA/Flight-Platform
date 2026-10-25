CREATE TABLE gateway.scheduler_locks (
  task TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL
);
