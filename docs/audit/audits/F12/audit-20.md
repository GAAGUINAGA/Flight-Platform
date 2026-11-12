# Auditoría F12 — #20
- Fecha: 2026-11-11 · Commit auditado: a069b9b1e5c01287d244140c361618ba754eab0c · Veredicto: RECHAZADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ CI del gateway: 299/299; CI de Reservation: 202/202; Reservation real: 19/19 al repetir; Gateway real completo: dos corridas consecutivas de 956 aprobadas y 1 `todo` (957 cada una). El tope concurrente de B-1 incumple Q11. |
| Pruebas de seguridad | ✔ Suites de seguridad y aislamiento del gateway y Reservation aprobadas; autorización admin, correo confirmado, canal por token, llave interna, entradas inválidas, 404 de owner ajeno, errores y logs redactados. |
| Checklist de cierre | ✘ B-1 no mantiene los topes ante reservas simultáneas. Lint, política de dependencias, variables de despliegue y ambos workflows de CI aprobados; imágenes y hook constan verificados por el humano. |
| Conformidad con el contrato | ✔ Ajv en la suite real v2; contrato público v1/v2, `.proto` y migraciones sin cambios respecto a `origin/main`. |

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | B-1 / Q11 | `platform/api-gateway/src/v2/web-sales.ts:56-64`; `platform/api-gateway/src/v2/booking.controller.ts:56-63` | Dos POST simultáneos del mismo owner con holds y claves de idempotencia distintos pueden leer el mismo conteo bajo el tope y crear ambas reservas; la comprobación y la creación no son atómicas. |

## Observaciones (no bloquean → BACKLOG)
- La primera corrida real de Reservation falló `PST-07 / C` (esperaba `QUOTE_EXPIRED`, recibió `BOOKING_NOT_CONFIRMED`); la repetición aprobó 19/19.
- La primera corrida completa del gateway falló `V2-P1-43` (esperaba 200, recibió 503); las dos siguientes aprobaron 956/956 ejecutadas, con 1 `todo` cada una.
