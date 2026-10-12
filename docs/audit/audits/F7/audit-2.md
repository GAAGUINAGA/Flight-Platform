# Auditoría F7 — #2
- Fecha: 2026-10-11 · Commit auditado: ae83100 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ `npm run lint` sin errores; `npx jest microservices/ancillaries-service --runInBand` con `DATABASE_URL` cargada en el entorno: 10 suites, 30 pruebas verdes, 1 omitida (ANC-10 real, ejecución humana); `npx jest packages/shared --runInBand`: 11 verdes. ANC-06/ANC-09 corren contra Postgres real: 10 reservas simultáneas del mismo asiento ⇒ 1 éxito y 1 fila activa; 10 compras de equipaje ⇒ 3 éxitos |
| Pruebas de seguridad | ✔ H1 de audit-1 resuelto: las 9 pruebas `ANC-SEC-02 / S` (ReserveSeats, ConfirmSeats, ReleaseSeats, ReleaseAll, GetAssignments, AssignSeatAtCheckIn, ReserveBaggage, GetBaggageOptions, PurchaseBaggage) pasan por servidor gRPC real con owner-B sobre reserva de owner-A: `NOT_FOUND` y conteos de filas sin cambio. ANC-SEC-01 y ANC-SEC-03 verdes (llave ausente/incorrecta, entrada inválida, rol `customer` en ReleaseAll, error interno sin detalles, logs redactados). Sin filas residuales en `booking_owners` tras la suite |
| Checklist de cierre | ✔ Concurrencia de asientos verde; seat map conforme (ANC-04 K contra `SeatMapResponse` con Ajv, sin precios); seguridad verde; `docker build` en el clon y `docker run --rm` con `PORT=8080` ⇒ health `SERVING`, sin llave ⇒ `UNAUTHENTICATED`, contenedor eliminado. El smoke en Cloud Run no se evalúa en esta auditoría de código |
| Conformidad con el contrato | ✔ `git diff origin/main` vacío en `microservices/pricing-service` y `contracts/openapi`; proto solo agrega `segment_id = 2`, `passenger_type = 6`, `cabin_class = 7`; builds de shared, inventory, ticketing, webhooks, pricing, operations, ancillaries y api-gateway verdes; migración `booking_owners` solo crea una tabla, sin `CREATE SCHEMA`/`EXTENSION` |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- ANC-02: ninguna prueba inserta directamente un segundo asiento activo; el rechazo del índice parcial se observa vía `SEAT_TAKEN` (`P2002`) en ANC-06/ANC-09 y su existencia en `pg_indexes`.
- ANC-06: `ConfirmSeats`, `ReleaseSeats` y `GetAssignments` no tienen prueba de integración de camino feliz; solo se prueban en su rama de owner ajeno.
- ANC-SEC-01: la cantidad 1–3 de equipaje no se prueba por gRPC.
- ANC-10: el cambio humano en `anc-10-real.spec.ts` solo ajusta espacios (coincide con `smoke.cjs:21`); evidencia del humano en bitácora dev F7 #2.
- La bitácora dev F7 #3 termina con `Commit final: pendiente · Estado: en curso` y tiene una fila separadora duplicada; el SHA ae83100 proviene de la solicitud de auditoría.
- `audit-1.md` no está en el repositorio ni en el clon; el hallazgo H1 se verificó a partir de la solicitud y de la bitácora dev F7 #3.
- La suite de Postgres no carga `.env`; requiere `DATABASE_URL` en el entorno del proceso.
