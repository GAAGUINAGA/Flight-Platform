-- F12c-4a (ADR-F12c4-01): registro de acciones del administrador. Aditiva, con esquema explícito.
-- Sin datos de la reserva: solo actor, acción, sujeto (PNR validado, bookingId o flightInstanceId), resultado y correlación.
-- El rol del Gateway solo inserta y lee (los permisos los administra el humano en infra/db/roles.sql; esta migración no los toca).
-- Retención 12 meses: el depurado es una tarea manual con un rol propietario (docs/dev/f12c4a-pnr-despliegue.md).
CREATE TABLE gateway.admin_access_log (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_sub TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT,
  result TEXT NOT NULL,
  error_code TEXT,
  correlation_id TEXT,
  CONSTRAINT admin_access_log_pkey PRIMARY KEY (id)
);
CREATE INDEX admin_access_log_actor_sub_at_idx ON gateway.admin_access_log (actor_sub, at);
CREATE INDEX admin_access_log_at_idx ON gateway.admin_access_log (at);
