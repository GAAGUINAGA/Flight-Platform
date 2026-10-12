# Auditoría F8 — #1
- Fecha: 2026-10-11 · Commit auditado: 73d2555 · Veredicto: RECHAZADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✘ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | ✘ |

Comandos ejecutados en el clon `C:\Proyectos\fp-audit`: `npm run lint` (sin errores); `npx jest microservices/reservation-service --runInBand` (10 suites / 41 pruebas verdes, 4 omitidas); `npx jest packages/shared --runInBand` (11 verdes); `RUN_RSV12_REAL=true npx jest .../rsv-12-real.spec.ts --runInBand` (4 verdes). `packages/` y `contracts/` sin cambios respecto de origin/main. RSV-13 no se evalúa (nota de la auditoría).

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | RSV-12 | `test/integration/rsv-12-real.spec.ts:92-95` | Los cuatro `it` solo hacen `expect(create).toBeDefined()`: no crean hold, no llaman a `CreateReservation`/`ResumePending`, no usan `TICKETING_FAIL_MODE=always` ni verifican tickets, estados ni recursos liberados. Pasan en 0–3 ms con los cinco servicios levantados pero sin ejercitarlos; el pago pendiente no llega a CONFIRMED vía ResumePending. |
| H2 | RSV-08 | `src/application/queries.ts:3`; `test/rsv-07-10.spec.ts:10` | La vista de detalle devuelve `tickets: []` fija y no consulta Ancillaries (asientos, equipaje) ni Ticketing. La prueba K usa `toMatchObject` sobre una reserva sembrada con `passengers: []`/`tickets: []`; no valida contra el schema `BookingDetail` del OpenAPI. |
| H3 | RSV-02 / RSV-06 | `src/main.ts:27` | El servicio arranca con `InMemoryReservationStore`; `PrismaReservationStore` solo se referencia desde pruebas. El servicio desplegable no persiste reservas, idempotencia ni `payment_usages` en `schema=reservation`. |
| H4 | RSV-10 | `src/application/queries.ts:8` | `byFlightInstance` devuelve siempre `{ items: [], nextCursor: undefined }` sin consultar el store; `GetReservationSnapshot` se resuelve con `queries.get` (main.ts:28). No existe prueba que ejerza datos reales para esta RPC. |
| H5 | RSV-SEC-02 / RSV-SEC-04 | `test/security/reservation-security.spec.ts:15,20` | No hay prueba "otro owner ⇒ NOT_FOUND" por gRPC real para ninguna operación: el servidor de la suite usa `deps` falsos (`getReservation` devuelve un objeto fijo); la prueba solo comprueba qué `ownerId` recibe el stub. `ListReservations` y `GetReservationSnapshot` no tienen prueba de seguridad por gRPC. |

## Observaciones (no bloquean → BACKLOG)
- RSV-07: la prueba de "emisión fallida ×3" siembra `attempts = 3` y no provoca tres fallos reales de emisión (`test/rsv-07-10.spec.ts:9`).
- RSV-11: la concurrencia se resuelve con una cola en memoria dentro de `CreateReservation` (`create-reservation.ts:9-14`); la prueba contra Postgres usa una sola instancia.
- RSV-02: la prueba solo lee el texto de `migration.sql` (`test/rsv-02-schema.spec.ts:8`); no consulta la base.
- RSV-09: `list` devuelve `origin`, `destination` y `departureDate` vacíos (`queries.ts:7`).
- La bitácora `2026-10-11_dev_F8_2.md` conserva el marcador `<pega el contenido de C:\Proyectos\rsv12-F8.txt>` en lugar de la evidencia.
