# Auditoría F12 — #9
- Fecha: 2026-11-08 · Commit auditado: 2e12b343b90f24b4565e0d6ff16c00c1edd13744 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Gateway real: 22 suites, 643 aprobadas, 1 todo; pasos locales de CI de los otros servicios y gateway ejecutados secuencialmente. |
| Pruebas de seguridad | ✔ Suites del gateway incluidas; lint y audit-policy pasaron. |
| Checklist de cierre | ✘ deploy-hello falla en prisma:generate en clon limpio; los demás workflows completaron sus pasos locales. |
| Conformidad con el contrato | ✔ Sin cambios de código ni contratos desde 2e12b34, revisados en audit-8. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | LD-T7, checklist de cierre | `npm run prisma:generate -w platform/hello` en `C:\Proyectos\fp-audit-ci-ld2` | El workflow `deploy-hello` falla con `Missing script: "prisma:generate"` (rc=1). |
## Observaciones (no bloquean → BACKLOG)
- La última bitácora del developer lista para auditoría señala 2e12b34; no hay un commit posterior de corrección en la rama auditada.
