# Auditoría F4 — #6
- Fecha: 2026-10-11 · Commit auditado: 29b709c (main) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- Evidencia del humano (no verificada por el auditor): `docs/dev/progress/2026-10-11_dev_F4_deploy_1.md` registra `prisma migrate status` del esquema `gateway` ("Database schema is up to date!"). No ejecuté la migración ni leí credenciales.
- GW-10, verificado por mí contra `https://flight-gateway-o37n.onrender.com`:
  - `GET /flights/v1/health` → 200 `{"status":"ok"}`, con `strict-transport-security: max-age=15552000; includeSubDomains`.
  - `GET http://…/flights/v1/health` → 301, `Location: https://flight-gateway-o37n.onrender.com/flights/v1/health`.
  - `GET /flights/v1/no-existe-xyz` → 404 `application/problem+json`, `code: VALIDATION_FAILED` (presente en el enum del OpenAPI, línea 751).
  - `POST /flights/v1/__test/secured` → 404 `application/problem+json`, `code: VALIDATION_FAILED`; la ruta de prueba no existe en producción.
  - `x-correlation-id` presente en las tres respuestas HTTPS del servicio (200, 404, 404). La respuesta 301 de http:// no lo trae; la emite la capa de borde de Render, no el Gateway.
