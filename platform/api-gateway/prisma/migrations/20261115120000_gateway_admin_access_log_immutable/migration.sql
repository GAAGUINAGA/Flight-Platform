-- F12c-4a, corrección previa a la auditoría (ADR-F12c4-01, adenda): el registro de accesos del administrador es de SOLO INSERCIÓN.
-- Aditiva y con esquema explícito. Primera capa (defensa en dos capas): triggers que lanzan una excepción ante UPDATE, DELETE y TRUNCATE,
-- aunque quien los ejecute sea el dueño de la tabla (el dueño puede volver a darse permisos, pero no ejecuta esto sin desactivar el trigger a propósito).
-- La segunda capa (cambiar el dueño a un rol distinto de svc_gateway y dejarle solo INSERT y SELECT) es un paso del humano: docs/dev/f12c4a-pnr-despliegue.md §2.
-- El depurado a 12 meses lo hace un rol con privilegios desactivando y reactivando el trigger dentro de la misma transacción (§5 de esa guía).
CREATE FUNCTION gateway.admin_access_log_reject_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'gateway.admin_access_log es de solo insercion: % no permitido', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER admin_access_log_no_update_delete
  BEFORE UPDATE OR DELETE ON gateway.admin_access_log
  FOR EACH ROW EXECUTE FUNCTION gateway.admin_access_log_reject_change();

CREATE TRIGGER admin_access_log_no_truncate
  BEFORE TRUNCATE ON gateway.admin_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION gateway.admin_access_log_reject_change();
