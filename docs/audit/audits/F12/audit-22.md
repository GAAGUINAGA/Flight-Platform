# Auditoría F12 — #22
- Fecha: 2026-11-11 · Commit auditado: 59ca1153316ee90900e48b5c38e41271135b4c97 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ Carrera de topes Postgres 11/11; Reservation real 19/19; gateway real completo 44 suites, 957 aprobadas y 1 `todo` dos veces seguidas; los topes WEB se omiten en una entrada admitida por el RPC. |
| Pruebas de seguridad | ✔ Suites reales y unitarias aprobadas; llave interna, entrada inválida, owner, rol, errores y logs redactados. |
| Checklist de cierre | ✘ B-1/Q11 permite insertar una reserva WEB sin comprobar topes; CI de todos los workflows, lint, política y configuración aprobados; imágenes verificadas por el humano. |
| Conformidad con el contrato | ✔ Suite v2 con Ajv aprobada; OpenAPI público sin cambios y `.proto` aditivo. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | B-1 / Q11 | `microservices/reservation-service/src/infrastructure/grpc/reservation.controller.ts:21,65`; `microservices/reservation-service/src/application/create-reservation.ts:45-46`; `microservices/reservation-service/src/infrastructure/persistence/prisma-reservation-store.ts:23` | `CreateReservation` admite `paymentChannel=WEB` sin uno o ambos topes; esa entrada crea la reserva directamente, sin candado ni conteo, y permite superar un tope ya lleno. |
## Observaciones (no bloquean → BACKLOG)
- La primera corrida real completa del gateway falló al limpiar `flightInstance` en `real-stack.e2e.spec.ts:743` por `hold_lines_flight_instance_id_fkey`; las dos corridas completas siguientes pasaron (44 suites, 957 pruebas y 1 `todo` cada una).

Requiere decisión humana (PLAN §4.4 regla 4)
