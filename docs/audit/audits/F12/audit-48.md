# Auditoría F12 — #48
- Fecha: 2026-11-21 · Commit auditado: 389bd81cc9170397eeb5629c6b5e91f58e705ee7 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — CI limpio de Reservation: 267/267; integración real: 61/61, incluidos PST-BUS; regresión en 7e801ef: 7 casos CAB fallan. |
| Pruebas de seguridad | ✔ — unitarias de Reservation y Gateway real incluidas en las corridas verdes. |
| Checklist de cierre | ✘ — H1; lint, builds y audit-policy verdes; Gateway real ESB dos veces: 1081/1081 aprobadas cada vez; imagen y Playwright verificados por el humano. |
| Conformidad con el contrato | ✔ — CAB-09 devuelve `OFFER_NO_LONGER_AVAILABLE`; sin cambios en OpenAPI. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | RSV-06 / REGLA 1 | `microservices/reservation-service/src/application/create-reservation.ts:59-63`; `node` sobre build limpio con `findByPnr` siempre ocupado → `{"error":"PNR_CREATION_FAILED","paymentVoided":[]}` | Tras autorizar el pago, agotar los reintentos del PNR rechaza la compra sin anular el pago; falla el deshacer previo a persistir la reserva. |
## Observaciones (no bloquean → BACKLOG)
Ninguna.

Requiere decisión humana (PLAN §4.4 regla 4)
