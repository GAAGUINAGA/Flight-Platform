# ADR-F12a2-03 — Observaciones de la auditoría F12 #1 (bloque B)
- Estado: Aceptado · Fecha: 2026-10-27 · Fase/Tarea: F12a-2 / bloque B
## Contexto
`docs/audit/audits/F12/audit-1.md`, observaciones 3, 4 y 5.
## Decisión
- **Redacción de logs:** `REDACTED_LOG_PATHS` agrega `x-webhook-signature`, `x-api-key`, `x-user-id` y `x-device-fingerprint` (en `req.headers` y en cualquier `*.headers`).
- **422 del descuento después de autenticar:** el middleware HTTP ya no responde el 422 de `PUT /vuelos/promociones/contrato`. Aparta el valor fuera de 0–100 (`res.locals`) y lo sustituye por 0 para que el esquema OpenAPI no lo rechace con 400; el controlador, que corre después de la autenticación y de la guarda de scope, lo restituye y responde 422 `PROMOTION_DISCOUNT_OUT_OF_RANGE`. Sin token ⇒ 401, sin `flights:admin` ⇒ 403, con admin ⇒ 422.
- **`BOOKING_EVENTS_CLIENT_ID` obligatorio** cuando `BOOKING_EVENTS_SECRET` está configurado: `loadConfig` lanza error y el gateway no arranca. Excepción: `NODE_ENV=test`, porque las suites reales crean un cliente por escenario y comparten un solo gateway por archivo; cualquier otro entorno (producción, desarrollo, perfil local) lo exige.
## Consecuencias
- El perfil local de integración (`.local/`) debe definir `BOOKING_EVENTS_CLIENT_ID` (el `client_id` de Booking en el dev-auth) además del secreto.
- El validador OpenAPI del resto de operaciones v2 sigue corriendo antes de la autenticación (una petición sin token con cuerpo inválido recibe 400 en esas rutas). No era parte de la observación y queda en BACKLOG.
