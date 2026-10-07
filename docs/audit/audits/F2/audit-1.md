# Auditoría F2 — #1
- Fecha: 2026-10-07 · Commit auditado: 192e69d · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (clon limpio + `npm ci`; `npx jest microservices/ticketing-service --runInBand`, 3 corridas, 10/10; lint, build, `npm audit --audit-level=high` OK) | ✘ |
| Pruebas de seguridad (TKT-SEC-01..03; llave interna, entrada inválida, ajeno ⇒ NOT_FOUND y rol pasan; error interno forzado y log redactado sin prueba) | ✘ |
| Checklist de cierre (emisión idempotente ✔, respuestas mapeables ✔, seguridad ✘; smoke Cloud Run fuera de esta auditoría por flujo-cierre.md) | ✘ |
| Conformidad con el contrato (DTO vs `Ticket`, `TicketSegment`, `TicketListResponse`) | ✔ |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | TKT-04 | `grep -rniE '1000\|1 000' microservices/ticketing-service/test` ⇒ sin resultados; `test/unit/ticket.spec.ts` no cubre numeración | La prueba exigida («U: formato de 13 dígitos; I: 1 000 números únicos») no existe: no hay prueba unitaria de formato ni de 1 000 números únicos |
| H2 | TKT-SEC-03 | `grep -rniE 'redact\|stack\|forced' microservices/ticketing-service/test` ⇒ sin resultados; `test/integration/ticketing.spec.ts:23` cubre solo rol y ajeno | La suite §2.5 está incompleta: no existe prueba de error interno forzado sin stack/mensaje interno ni de log con PII redactado |
## Observaciones (no bloquean → BACKLOG)
- Con el `.env` copiado al clon y sin exportar las variables, las 7 pruebas de integración fallan con `DATABASE_URL is required for ticketing integration tests` (`ticketing.spec.ts:8`); con las variables exportadas pasan.
- TKT-05: la prueba de `TICKETING_FAIL_MODE=always` (`ticketing.spec.ts:16`) invoca el store, no el RPC; `first_attempt` no tiene prueba (comportamiento correcto en sondeo manual).
- TKT-07: `GetCouponsForBooking` y `GetTicket` exitoso sin prueba propia; TKT-SEC-01: la entrada inválida se prueba solo en `ListTickets`.
- TKT-06: el modelo no distingue cupones volados; `RefundTickets` solo exige cupones `ISSUED`.
- Existe una segunda migración (`20261007071000_allow_reissued_tickets`) no mencionada en la bitácora ni en el ADR.
- `dev_2_1.md` termina con «Commit final: pendiente · Estado: en curso» y a la vez «listo para auditoría de código».
- TKT-09 y smoke en Cloud Run quedan para la auditoría de despliegue.
