# Auditoría F8 — #2
- Fecha: 2026-10-12 · Commit auditado: 284146c · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados en el clon `C:\Proyectos\fp-audit` (284146c): `npx jest microservices/reservation-service --runInBand` (12 suites / 48 verdes, 4 omitidas = RSV-12 opt-in); `RUN_RSV12_REAL=true npx jest .../rsv-12-real.spec.ts --runInBand` (4/4 verdes: 731, 189, 545 y 98 ms); `npm run lint`, `npm run build -w @flight-platform/reservation-service` y `npm audit --audit-level=high` sin errores. `packages/` y `contracts/` sin cambios respecto de origin/main. Verificación de hallazgos previos: H1 `rsv-12-real.spec.ts:138-141` (los cuatro escenarios crean hold real, ejecutan `CreateReservation`/`ResumePending` y comprueban estados en tickets, asientos, hold, inventario y entregas de webhooks); H2 `queries.ts:7` y `rsv-07-10.spec.ts:18` (composición con Ancillaries/Ticketing y validación Ajv contra `BookingDetail`); H3 `main.ts:28` (`PrismaReservationStore`) y `rsv-11-postgres.spec.ts:20`; H4 `queries.ts:9` y `rsv-11-postgres.spec.ts:21`; H5 `reservation-owner-prisma.spec.ts:22-24` (otro owner ⇒ NOT_FOUND / vacío por gRPC real con Prisma). El smoke de Cloud Run (RSV-13) corresponde al despliegue posterior y queda fuera de esta auditoría de código; el contenedor fue verificado por el humano sobre 1e847e8.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- RSV-02: `test/rsv-02-schema.spec.ts` sigue leyendo el texto de `migration.sql`; la persistencia real se cubre en `rsv-11-postgres.spec.ts`.
- RSV-SEC-02: las pruebas por gRPC real de otro owner no incluyen un control positivo (el owner propio obtiene la reserva) en la misma suite.
- RSV-12 (ruta feliz): la comprobación de inventario vendido (`rsv-12-real.spec.ts:138`) busca cualquier `cabinInventory` con `sold > 0`, sin acotarlo al vuelo del hold.
- RSV-12 (hold expirado): el estado `EXPIRED` se inyecta en el `PricingPort` del test además de vencer el hold en Inventory.
- Smoke en Cloud Run (RSV-13) pendiente de despliegue.
