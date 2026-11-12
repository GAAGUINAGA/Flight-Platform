# Auditoría F12 — #21
- Fecha: 2026-11-11 · Commit auditado: 7e88d515af2bec5165a9b3dfd46baaf1c9edbb73 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ Gateway CI en clon limpio: 20 suites, 312/312; cupos Postgres: 11/11; Reservation real: 19/19 dos veces; gateway real completo: 45 suites, 980 aprobadas y 1 `todo` dos veces. B-1/Q11 incumple los topes en las rutas de recuperación y error. |
| Pruebas de seguridad | ✔ Suites del gateway y Reservation aprobadas; llave interna, entrada inválida, owner ajeno, rol, errores y logs redactados. |
| Checklist de cierre | ✘ B-1 no preserva los topes en todos los caminos. Lint, política de dependencias, `check-deploy-env`, build y CI en clon limpio aprobados; imagen verificada por el humano. |
| Conformidad con el contrato | ✔ Suite real v2 con Ajv aprobada; contrato público v2 sin cambios. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | B-1 / Q11 | `platform/api-gateway/src/v2/state.ts:143-144,161-163` | Con tope 1, un `PENDING` vencido se libera mientras su `createReservation` sigue activo, otro intento ocupa el cupo y la primera reserva al confirmarse suma forzosamente: quedan 2 activas; `WEBQ-DB-07` verifica la suma sin comprobar el tope. |
| H2 | B-1 / Q11 | `platform/api-gateway/src/v2/state.ts:179-181` | El recálculo lee `inFlight` y después sobrescribe `used` sin bloquear el contador durante esa lectura: una toma concurrente entre ambas sentencias queda borrada y un intento posterior puede superar el tope. |
| H3 | B-1 / Q11 | `platform/api-gateway/src/v2/booking.controller.ts:64-67` | Si Reservation crea la reserva pero se pierde la respuesta gRPC, el `catch` devuelve ambos cupos de una reserva existente; otra petición puede reservar por encima de los topes. |
## Observaciones (no bloquean → BACKLOG)
- La bitácora versionada del developer conserva «en curso» en la corrección 2 y el cierre antiguo `09f94ab`; el humano indicó expresamente `7e88d51` como commit listo para esta auditoría.
