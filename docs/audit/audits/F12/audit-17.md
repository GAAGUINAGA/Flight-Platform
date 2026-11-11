# Auditoría F12 — #17
- Fecha: 2026-11-10 · Commit auditado: 304c98ca11c3f796f03a4d77ee1ce805a27368fd · Veredicto: RECHAZADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Clon limpio `C:\Proyectos\fp-audit-ci-held`: nueve workflows, generación Prisma, lint, builds, unitarias y audit; local dos corridas de ancillaries (83), Operations (91), ESB (130), gateway real ESB (896) y dos corridas consecutivas de reservation real (231). |
| Pruebas de seguridad | ✔ Suites de servicio y gateway reales; owner, llave interna, rol, entrada inválida, errores y logs verificados en pruebas. |
| Checklist de cierre | ✘ Migración SQL sin esquema explícito; imágenes y recorrido local constan como verificaciones del humano en la bitácora. |
| Conformidad con el contrato | ✔ OpenAPI sin cambios; mapas v1/v2, 409 `SEAT_TAKEN`, `ProblemDetails` y feed `after` validados por pruebas Ajv y E2E. |

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12b1 · migración seat_hold | `microservices/ancillaries-service/prisma/migrations/20261109120000_seat_hold/migration.sql:5-6` | `ALTER TABLE` y `CREATE INDEX` usan `seat_assignments` sin esquema explícito; incumple la regla de SQL del servicio. |

## Observaciones (no bloquean → BACKLOG)
- La primera corrida de reservation real tuvo dos timeouts de 5 s en PST-03/04 y PST-07 (`rsv-12-real.spec.ts:320,413`); las dos corridas siguientes pasaron 231/231.
- El diff de `.proto` reescribe dos líneas de declaración; todos sus campos originales permanecen y solo se agregan campos/RPC.
