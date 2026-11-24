# F12c-4a — Buscar reserva por PNR y registro de acciones del administrador: despliegue y operación

Diseño: `docs/dev/f12c4-diseno.md` (§2, §4, §9) · Decisiones: `docs/dev/adr/ADR-F12c4-01-creacion-atomica-registro-de-accesos-y-duenio.md`.
Lo ejecuta el humano; el developer no toca `infra/` ni administra la base.

## 1. Qué cambia
| Pieza | Cambio (todo aditivo) |
|---|---|
| `contracts/proto` | Reservation `AdminGetReservationByPnr` (+ mensajes `AdminBookingView…`); Operations `AdminGetCheckInStatus` (+ mensajes). Ningún campo existente cambia |
| Reservation | RPC solo rol `admin`; esquema estricto (sin dueño; PNR del alfabeto de `createPnr`); vista de lista blanca sin datos personales |
| Operations | RPC solo rol `admin`; estado del check-in por `bookingId`, sin dueño |
| ESB | Operaciones `reservas.buscar-por-pnr` y `postventa.admin-estado-check-in` (`roles: ['admin']`) |
| Gateway | `POST /api/admin/v1/bookings/search`; tabla `gateway.admin_access_log` de solo inserción (triggers + dueño distinto de `svc_gateway`); límite por administrador. OpenAPI interno `admin-v1.yaml` (solo agregados) |
| GraphQL | `adminBookingByPnr(pnr)` (`@admin`; 404 ⇒ `null`); 30 operaciones publicadas (eran 29) |
| Web | Pantalla «Buscar reserva» (`/admin/reservas`) |

## 2. Orden de despliegue
1. **Migraciones del Gateway, ANTES del push/despliegue** (humano; local y Supabase): `prisma migrate deploy` aplica, en este orden, `20261115000000_gateway_admin_access_log` (tabla e índices, esquema `gateway`) y `20261115120000_gateway_admin_access_log_immutable` (triggers que rechazan UPDATE, DELETE y TRUNCATE). Ninguna concede permisos. Hay que aplicarlas **antes** de desplegar el Gateway nuevo: sin la tabla, la búsqueda responde 503 (falla cerrada). En Supabase, después de `migrate deploy`, `migrate status` y confirmar que el Datasource apunta a `pooler.supabase.com` (AGENTS.md).
2. **Paso del humano con un rol con privilegios (NO `svc_gateway`), DESPUÉS de las migraciones y ANTES de desplegar.** Quien crea la tabla es `svc_gateway` (el rol con el que se conecta el Gateway), así que es su dueño y tiene todos los permisos; un `REVOKE` sobre el dueño no protege (puede volver a otorgárselos). Se cambia el dueño a un rol distinto y se le deja solo `INSERT` y `SELECT`:
```sql
-- Con el administrador de la base (p. ej. `postgres`); sustituir <rol_admin_bd> por ese rol.
ALTER TABLE    gateway.admin_access_log                       OWNER TO <rol_admin_bd>;
ALTER FUNCTION gateway.admin_access_log_reject_change()       OWNER TO <rol_admin_bd>;
REVOKE ALL ON TABLE gateway.admin_access_log FROM svc_gateway;
GRANT  INSERT, SELECT ON TABLE gateway.admin_access_log TO svc_gateway;
-- svc_gateway ya tiene USAGE sobre el esquema gateway (infra/db/roles.sql); no hace falta nada más.
```
   Comprobar los permisos resultantes (deben dar exactamente lo esperado):
```sql
SELECT tableowner FROM pg_tables WHERE schemaname = 'gateway' AND tablename = 'admin_access_log';            -- <rol_admin_bd>, NO svc_gateway
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'gateway' AND table_name = 'admin_access_log' AND grantee = 'svc_gateway' ORDER BY 2;   -- solo INSERT y SELECT
SELECT has_table_privilege('svc_gateway', 'gateway.admin_access_log', p) AS privilegio, p
  FROM unnest(ARRAY['INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p;            -- true solo en INSERT y SELECT
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'gateway.admin_access_log'::regclass AND NOT tgisinternal; -- los dos triggers, 'O' (activos)
```
   Orden completo: **migraciones → este paso → comprobación → desplegar Gateway**. Para la base **local** es el mismo paso (con el rol administrador local). Después del cambio de dueño, cualquier migración futura que toque esta tabla debe correrla el rol dueño, no `svc_gateway`.
3. Servicios: **Reservation y Operations** (Cloud Run, sin variables nuevas), luego **ESB** (catálogo nuevo), luego **Gateway** (Render), luego **GraphQL** y por último la **web**. El Gateway y el ESB deben salir juntos: el Gateway llama a operaciones que el ESB antiguo no conoce (`VALIDATION_FAILED`/operación desconocida).
4. Variables del Gateway (opcionales, con estos valores por omisión): `ADMIN_PNR_SEARCH_LIMIT_PER_HOUR=30`, `ADMIN_CHECKIN_LIMIT_PER_HOUR=60` (esta última la usa F12c-4b).

## 3. Verificación después de desplegar
- Con un token de **administrador**, `POST /api/admin/v1/bookings/search` con `{"pnr":"<un PNR real>"}` ⇒ 200 con nombres, vuelos en hora local, asientos, boletos (últimos 4) y `checkIn`. Un PNR inexistente, ajeno o mal formado ⇒ 404 idéntico.
- Con token de cliente o de socio ⇒ 403. Sin token ⇒ 401.
- Comprobar que **no** salen documento, correo, teléfono ni referencia de pago, y que cada búsqueda dejó una fila (ver §4).
- Prueba de aceptación de 4b (`J4R8GZ`, check-in manual exitoso del 14-11-2026): al buscarla, el `checkIn` debe aparecer `COMPLETED`.

## 4. Consultas del registro (solo SQL; no hay listado en el panel, BACKLOG)
```sql
-- Búsquedas de un administrador en las últimas 24 h (sin datos de la reserva)
SELECT at, action, subject, result, error_code, correlation_id
  FROM gateway.admin_access_log
 WHERE actor_sub = '<sub del administrador>' AND at > now() - interval '24 hours'
 ORDER BY at DESC;
-- Quién consultó un PNR
SELECT at, actor_sub, result FROM gateway.admin_access_log WHERE action = 'SEARCH_PNR' AND subject = '<PNR>' ORDER BY at DESC;
```

## 5. Retención: 12 meses, depurado MANUAL con un rol con privilegios
`svc_gateway` no puede borrar (sin permiso, y además el trigger lo impide). Una vez al mes (o antes de cada auditoría), con el rol **dueño** (`<rol_admin_bd>`), todo en UNA transacción para que el trigger quede siempre activo al terminar:
```sql
BEGIN;
ALTER TABLE gateway.admin_access_log DISABLE TRIGGER admin_access_log_no_update_delete;
DELETE FROM gateway.admin_access_log WHERE at < now() - interval '12 months';
ALTER TABLE gateway.admin_access_log ENABLE TRIGGER admin_access_log_no_update_delete;
COMMIT;
-- Comprobar: SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'gateway.admin_access_log'::regclass AND NOT tgisinternal;  -- ambos 'O'
```
(`TRUNCATE` no se usa para depurar: el trigger de TRUNCATE no se desactiva.) Registrar la ejecución (fecha y filas borradas) en el BACKLOG o en la bitácora de operación. El límite de búsquedas solo mira la última hora, así que no depende del depurado.

## 5b. Qué es un «intento» (ADR-F12c4-01, adenda audit-39)
Un intento es un pedido de un administrador autenticado que pasó las comprobaciones de transporte (HTTPS). Orden: transporte → autenticación → rol → punto único (leer el cuerpo → LÍMITE → validar → buscar). Todo lo que ocurre en el punto único deja **una fila** antes de responder (`FOUND`, `NOT_FOUND`, `INVALID_FORMAT`, `RATE_LIMITED`, `ERROR`). Lo rechazado antes (sin HTTPS ⇒ 400, sin sesión o sesión inválida ⇒ 401, no administrador ⇒ 403, límite GENERAL del gateway ⇒ 429) **no** deja fila en esta tabla: no hay un administrador al que atribuirlo y aceptarlo permitiría que cualquiera llene una tabla de solo inserción. Ese rastro está en los registros normales del gateway, buscando por el `X-Correlation-Id` de la respuesta. El cuerpo se lee solo después de la autenticación y del rol. Un cuerpo inválido responde 404 (no 400), salvo que el administrador haya alcanzado su límite: entonces responde 429 con `Retry-After` y la fila es `RATE_LIMITED` (el 429 tiene precedencia sobre el 404 de un cuerpo inválido; quien agotó su cupo queda bloqueado para todo, sin que el gateway procese lo que envía).

## 6. Qué NO guarda el registro
Datos de la reserva, nombres, cuerpos de petición ni IPs. Un PNR mal formado se registra como `INVALID_FORMAT` **sin su texto**. El PNR de una búsqueda sí consta (es lo que se audita) cuando tiene el formato válido.

## 7. Comportamiento ante fallos
- Si el registro no puede escribirse, **no se devuelve la reserva** (503 `PROVIDER_UNAVAILABLE`, `Retry-After`).
- Si Operations no responde, la búsqueda devuelve la reserva con el check-in `UNKNOWN` (disponibilidad, decisión 9 del 2026-11-22; ADR-F12c4-01, adenda) y se registra como `FOUND`; el panel deshabilita el check-in y los pases hasta volver a consultar. Si falla Reservation, la búsqueda falla (503) y queda registrada como `ERROR`. *(Antes de la entrega 2 fallaba completa en ambos casos.)*
- Superar el límite ⇒ 429 `RATE_LIMIT_EXCEEDED` (`type` `admin-pnr-search-limit`, `Retry-After: 60`); los intentos rechazados por el límite no cuentan, así que el bloqueo termina al pasar la hora.
