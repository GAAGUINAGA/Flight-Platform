# Auditoría F12 — #40
- Fecha: 2026-11-15 · Commit auditado: cbb857e01132463cc64af09a68b7385795a5a751 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ — Gateway CI 349/349, registro real 6/6 y gateway real 648/648 dos veces; H1 incumple el orden obligatorio de la tarea. |
| Pruebas de seguridad | ✔ — ADM4-P-19/20, roles, registro cerrado y vista de lista blanca pasan. |
| Checklist de cierre | ✘ — Lint, builds limpios, política, codegen y pruebas pasan; H1 deja incumplido el comportamiento de la búsqueda. Imagen y frontera manual verificadas por el humano. |
| Conformidad con el contrato | ✘ — OpenAPI público sin cambios; H1 contradice el 404 declarado para cuerpo inválido en el contrato interno. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-4a, orden validar → límite en búsqueda por PNR | `platform/api-gateway/src/admin-api.ts:62` | Tras alcanzar el límite horario, un administrador que envía `{}` recibe 429 y una fila `RATE_LIMITED` antes de validar el cuerpo; el contrato interno exige 404 para cuerpo inválido y el orden obligatorio valida antes del límite. |
## Observaciones (no bloquean → BACKLOG)
Ninguna.

Requiere decisión humana (PLAN §4.4 regla 4)
