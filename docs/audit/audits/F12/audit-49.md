# Auditoría F12 — #49
- Fecha: 2026-11-21 · Commit auditado: 053a0d6e142b00ff5efb7db80f93d199c39bbb2a · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — CI limpio de Reservation: 272/272; integración real: 61/61; PRT-01..04 reproducen fallos sin la corrección. |
| Pruebas de seguridad | ✔ — unitarias de Reservation y Gateway real ESB: 677/677 aprobadas en cada una de dos corridas. |
| Checklist de cierre | ✘ — H1; lint, builds y audit-policy verdes; imagen verificada por el humano en la ronda previa. |
| Conformidad con el contrato | ✔ — sin cambios en OpenAPI ni en el mapeo al cliente; Gateway real verde. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | RSV-06 / REGLA 1 | `microservices/reservation-service/src/application/create-reservation.ts:70-71`; reproducción sobre el build limpio con `store.create` fallido y `findByPaymentReference` devolviendo la reserva de esta operación → `{"sameError":true,"returnedOwnerIsOwn":true,"trail":["verify"]}` | El bloque omite `payment.void` ante cualquier reserva encontrada, incluida la propia; la salvedad aceptada solo cubre una referencia de OTRA reserva. |
## Observaciones (no bloquean → BACKLOG)
Ninguna.

Requiere decisión humana (PLAN §4.4 regla 4)
