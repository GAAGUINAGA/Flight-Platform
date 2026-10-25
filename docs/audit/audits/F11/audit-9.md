# Auditoría F11 — #9
- Fecha: 2026-10-24 · Commit auditado: df58539 (HEAD 0b4cca8 solo añade `BACKLOG.md`) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle (Node 20.20.2, clon en `C:\Proyectos\fp-audit`, Postgres local):
- `npm run lint` → 0 errores y 0 advertencias; `node scripts/audit-policy.cjs` → código 0 ("npm audit policy passed").
- `npm run build` de shared, api-gateway, pricing, webhooks, reservation y operations → exit 0 en los seis.
- CI por workflow: gateway 5 suites / 53; pricing 4 / 14; webhooks 1 / 4; reservation 21 / 98; operations 13 / 45. Todos exit 0.
- Suites completas: pricing 32/32; webhooks 19/19; reservation 114 pasan y 19 omitidas (sin flags reales); operations 62 pasan y 2 omitidas (sin flag real).
- Suites reales, dos ejecuciones seguidas, ambas exit 0: gateway (`RUN_GATEWAY_REAL=true`) 8 suites, 152 pasan + 1 todo (OP-02); reservation (`RUN_RSV12_REAL`, `RUN_PST_REAL`, `RUN_PST_SMOKE_REAL`) 27 suites, 133/133, 0 omitidas; operations (`RUN_DCS_REAL`) 17 suites, 64/64, 0 omitidas.
- PLT-G: pruebas K con Ajv (`WebhookSubscription`), 401, 403 (customer; partner sin scope), 404 de otro sub, 400 (UUID, cuerpo inválido, URL privada), secreto enmascarado en respuestas y ausente en logs del Gateway.
- PLT-H1: `@Roles('admin')` + scope `flights:admin`; 401, customer 403, partner 403 y admin sin scope 403 en las 6 rutas; 14 casos de entrada inválida ⇒ 400, con campos desconocidos incluidos (`admin.schemas.ts` `.strict()`).
- J6 admin: retraso ⇒ `flight.schedule_changed` y cancelación ⇒ `flight.cancelled`, una entrega por reserva (dos dueños), `WebhookPayload` validado con Ajv, venta cerrada y nueva retención rechazada, repetir la cancelación no duplica. La paginación sobre más de una página se prueba en `flight-status-notify.spec.ts` (OPS-ADM-04, 3 páginas) y en `reservation-by-flight.spec.ts` (Prisma+gRPC reales, 3 páginas).
- PLT-SEC-01 / PLT-SEC-02: customer con emisor JWKS local lee sus reservas y recibe 403 en `/admin`; admin no ve reservas ajenas (404); firma ajena y emisor desconocido ⇒ 401; partner gestiona webhooks, reserva ajena ⇒ 404 y rutas admin ⇒ 403.
- UpsertFare: PRC-ADM-01 (validación), 01b (rol), 01c/01d y PRC-ADM-02 (creación, actualización sin duplicar y búsqueda real) pasan.
- Contratos: `git diff 4db1bf5 HEAD -- contracts/openapi` vacío; el único cambio gRPC es `reservation.proto`; `pricing.proto` y `common.proto` sin cambios.
- No se repitió el `docker build` (verificado por el humano, según las notas).
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- O1 · `contracts/proto/flightplatform/reservation/v1/reservation.proto:10`: `ListReservationsByFlightInstance` cambia su tipo de respuesta a `ListReservationsByFlightInstanceResponse`. Los campos 1–7 coinciden en el cable con `BookingSummary` y `owner_id` es el campo 8, pero a nivel de tipo no es un cambio puramente aditivo.
- O2 · `docs/dev/progress/2026-10-24_dev_F11_1.md` (fila PLT-H1): dice que los campos desconocidos se descartan y que no hay casos "campo extra ⇒ 400". El código (`admin.schemas.ts`) y las pruebas H1 sí los rechazan con 400.
- O3 · J6 verifica las entregas en la tabla `delivery`, no por HTTP real a un receptor (decisión del humano; el envío HTTP se probó en F3).
- O4 · PLT-SEC-01 usa un emisor JWKS local con la forma de Supabase, no un token real de Supabase Auth (decisión del humano).
