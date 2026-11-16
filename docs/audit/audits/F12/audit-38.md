# Auditoría F12 — #38
- Fecha: 2026-11-15 · Commit auditado: 19979aad838be0d73c99f2ec7c2f6a6fc61918c0 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — CI en `C:\Proyectos\fp-audit-ci-f12c4a`: gateway 328, GraphQL 131, Reservation 238, Operations 77, ESB 124, paquetes 97 y web 313; integración del registro 5, Reservation real 19, Operations real 2; gateway real dos veces 669/669. |
| Pruebas de seguridad | ✘ — Autorización, aislamiento, triggers y respuestas de error probados; los hallazgos H1 y H2 afectan el registro. |
| Checklist de cierre | ✘ — Lint, audit-policy, npm audit, codegen, builds y pruebas pasaron; el registro de todos los intentos y su redacción no se cumplen. Dueño, privilegios y triggers locales comprobados con SQL de solo lectura. |
| Conformidad con el contrato | ✔ — OpenAPI público v2 sin cambios; búsqueda administrativa y GraphQL aditivos, con 404/null y lista blanca verificados. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-4a, registrar todo intento de búsqueda | `platform/api-gateway/src/admin-api.ts:118` | El validador responde 400 a un administrador que envía `{}` o `{"pnr":5}` antes de ejecutar `searchBooking`; el intento no queda registrado. |
| H2 | F12c-4a, registro sin PII ni secretos | `platform/api-gateway/src/admin-api.ts:87` | `errorCodeOf` copia hasta 64 caracteres de `error.details` al campo persistente `error_code` sin redacción; un error de Reservation u Operations puede guardar texto sensible. |
## Observaciones (no bloquean → BACKLOG)
Ninguna.
