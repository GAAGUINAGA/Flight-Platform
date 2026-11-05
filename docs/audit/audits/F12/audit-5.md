# Auditoría F12 — #5
- Fecha: 2026-11-05 · Commit auditado: 445d71f058b96776b3c35709ce4b6cdb197a5d24 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ ESB: 6 suites/73 pruebas; Gateway real: 35 suites/852 pruebas y 1 `todo` en cada una de tres corridas (ESB ×2, gRPC ×1); todas cerraron solas. |
| Pruebas de seguridad | ✔ Llave, entrada, roles, owner, errores y logs cubiertos por ESB y Gateway; `audit:policy` y `npm audit --audit-level=high` pasaron. |
| Checklist de cierre | ✔ Lint y workflows `deploy-esb.yml` y `gateway-ci.yml` repetidos en clon limpio sin `DATABASE_URL`; builds sin errores. Docker y recorrido local 31/31 ×2 verificados por el humano en la bitácora. Sin cambios en otros microservicios, `contracts/` ni migraciones. |
| Conformidad con el contrato | ✔ Suites v1/v2 y matriz sin cambios en aserciones; ESBT-18 conserva 503, `Retry-After` y `PROVIDER_UNAVAILABLE` ante ESB caído, servicio caído y plazo vencido. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
1. Bloque 0: `platform/api-gateway/src/esb-client.ts:45-48` no reenvía `Idempotency-Key` ni registra su huella, aunque el contrato interno aprobado lo describe en `docs/dev/f12b1-diseno-esb.md:83`; la clave que usa el servicio sigue viajando en `input`.