# Auditoría F12 — #46
- Fecha: 2026-11-20 · Commit auditado: e89f0c746052af12a1dafa30b47f9b12a0a98daa · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — clon limpio: Reservation 251/251, Ancillaries 40/40, Inventory 37/37, Gateway 404/404; RSV-12/PST 24/24 (PST-BUS-00..04), compra v2 por cabina 5/5, Gateway real con ESB dos veces 653/653 cada una; web 348/351 y reejecución de los tres archivos fallidos 81/81. |
| Pruebas de seguridad | ✔ — Reservation 19/19, Ancillaries e Inventory integraciones y seguridad 50/50 y 67/67; Gateway real 22 suites verdes en ambas corridas. |
| Checklist de cierre | ✘ — el cambio de fecha con cabinas distintas no conserva la cabina comprada por segmento; lint, builds, bundle y política de auditoría verdes; imágenes y Playwright verificados por el humano. |
| Conformidad con el contrato | ✔ — compra v2 por cabina y las suites reales del Gateway verdes; sin cambios en OpenAPI ni migraciones. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12 / corrección de cabina por segmento en postventa | `microservices/reservation-service/src/application/confirm-date-change.ts:52,55,74`; `microservices/reservation-service/src/application/resume-pending.ts:94` | Al cambiar el segundo itinerario de una reserva con cabinas distintas, el hold y los asientos nuevos reciben la cabina del primer itinerario; el reintento repite esa cabina y el asiento del tramo cambiado no se puede reservar. |
## Observaciones (no bloquean → BACKLOG)
- `npm test -w @flight-platform/web` falló en 3 pruebas de administración por espera de elementos (348/351); los tres archivos pasaron juntos con un trabajador (81/81), sin cambios de administración en esta rama.
