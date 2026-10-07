# Auditoría F2 — #2
- Fecha: 2026-10-07 · Commit auditado: 1ac509a · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (clon limpio + `npm ci`; `npx jest microservices/ticketing-service --runInBand`, 3 corridas, 12/12; lint, build, `npm audit --audit-level=high` exit 0). H1 resuelto | ✔ |
| Pruebas de seguridad (TKT-SEC-01..03; llave interna, entrada inválida, ajeno ⇒ NOT_FOUND, rol, error interno forzado y log redactado). H2 resuelto | ✔ |
| Checklist de cierre (emisión idempotente, respuestas mapeables, seguridad verde). Smoke en Cloud Run: fuera de esta auditoría (flujo-cierre.md) | ✔ |
| Conformidad con el contrato (DTO vs `Ticket`, `TicketSegment`, `TicketListResponse`) | ✔ |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- Con el `.env` copiado al clon y sin exportar las variables, las pruebas de integración fallan con `DATABASE_URL is required for ticketing integration tests` (`ticketing.spec.ts:9`); con las variables exportadas pasan.
- TKT-05: la prueba de `TICKETING_FAIL_MODE=always` invoca el store, no el RPC; `first_attempt` sin prueba (comportamiento correcto en sondeo manual de la auditoría #1).
- TKT-07: `GetCouponsForBooking` y `GetTicket` exitoso sin prueba propia; TKT-SEC-01: entrada inválida probada solo en `ListTickets`.
- TKT-06: el modelo no distingue cupones volados; `RefundTickets` solo exige cupones `ISSUED`.
- Segunda migración (`20261007071000_allow_reissued_tickets`) no mencionada en la bitácora ni en el ADR.
- `dev_2_1.md` conserva «Commit final: pendiente · Estado: en curso» junto a «listo para auditoría de código».
- TKT-09 y smoke en Cloud Run quedan para la auditoría de despliegue.
