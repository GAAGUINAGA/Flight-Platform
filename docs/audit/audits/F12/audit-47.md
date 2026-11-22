# Auditoría F12 — #47
- Fecha: 2026-11-21 · Commit auditado: 7e801ef0ad625b8352c9cfe3a52e0e8eac5be5ad · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ — CI de Reservation en clon limpio: 259/259; Reservation real: 25/25, incluidos PST-BUS-00..05; las pruebas no cubren H1 y H2. |
| Pruebas de seguridad | ✔ — unitarias de Reservation y Gateway real incluidas en las corridas verdes. |
| Checklist de cierre | ✘ — H1 y H2; lint, builds y audit-policy verdes; Gateway real con ESB dos veces: 677/677 aprobadas cada vez; imagen y Playwright verificados por el humano. |
| Conformidad con el contrato | ✘ — H2 devuelve una cabina cuando corresponde `OFFER_NO_LONGER_AVAILABLE`; sin cambios en OpenAPI. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12 / cambio de fecha, asiento ajeno sin efectos | `microservices/reservation-service/src/application/confirm-date-change.ts:45-58`; `microservices/reservation-service/test/cabin-by-segment.spec.ts:45,70` | Con diferencia a pagar y asiento de tramo ajeno, se reclama y verifica el pago antes del rechazo `OFFER_NO_LONGER_AVAILABLE`; la referencia queda reclamada aunque no se cree el hold ni cambie la reserva; CAB-07 solo usa importe cero. |
| H2 | F12 / cabina no determinable | `microservices/reservation-service/src/application/allocation.ts:18-21`; `node -e` sobre el build limpio: `cabinOfSegment([{segments:[{segmentId:'s'}],pricingOptions:[{fareRules:{isChangeable:true}},{cabinClass:'ECONOMY',fareRules:{isChangeable:false}}]}],'s',o=>o.fareRules?.isChangeable===true)` → `ECONOMY` | Si la tarifa cambiable no tiene cabina, `prefer` descarta ese caso y usa la cabina de una tarifa no cambiable en vez de lanzar `OFFER_NO_LONGER_AVAILABLE`. |
## Observaciones (no bloquean → BACKLOG)
Ninguna.
