# Auditoría F12 — #43
- Fecha: 2026-11-16 · Commit auditado: 0e2777e · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Gateway 400/400; GraphQL 140/140; web 345/345; integración Gateway 24/24; Gateway real 1072/1072 (1 todo). |
| Pruebas de seguridad | ✔ Rol y registro de OPEN_FLIGHT/REJECTED en las suites Gateway; listas cerradas verificadas. |
| Checklist de cierre | ✔ H1 corregido: ambas aperturas del Gateway usan `openChecked`; cabina sin tarifa válida ⇒ 409 y vuelo cerrado. |
| Conformidad con el contrato | ✔ OpenAPI público sin cambios; `FLIGHT_NOT_READY` 409 con cabinas faltantes en el contrato interno. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- Inventory permite la apertura directa por RPC con rol admin sin leer Pricing (`microservices/inventory-service/src/application/flight-admin.ts:83`); límite ya registrado en BACKLOG y ADR.
