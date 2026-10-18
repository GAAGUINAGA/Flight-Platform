# Auditoría F10 — #1
- Fecha: 2026-10-18 · Commit auditado: 30272e6 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ (smoke en Cloud Run fuera de alcance de esta auditoría) |
| Conformidad con el contrato | ✔ |

Comandos ejecutados en el clon (Node 20, Postgres local 127.0.0.1:15432):
- `npm run lint`: sin errores ni advertencias.
- CI operations (`npx jest microservices/operations-service/test --runInBand --testPathIgnorePatterns=integration`): 11 suites, 46 pruebas ✔.
- CI ancillaries (mismo patrón): 11 suites, 21 pruebas ✔.
- `RUN_DCS_REAL=true` sobre `microservices/operations-service/test/integration`, dos veces seguidas: 3 suites, 9 pruebas ✔ en ambas, 0 omitidas (incluye `DCS-SMOKE`, que exige los 8 pasos `OK` de `check-in-smoke.cjs`).
- Suite completa de operations con `RUN_DCS_REAL=true`: 14 suites, 55 pruebas ✔, 0 omitidas.
- Suite completa de ancillaries: 14 suites, 35 ✔, 1 omitida (`anc-10-real.spec.ts`, opt-in `RUN_ANC10_REAL`, ajena a F10).
- Integración de reservation con `RUN_RSV12_REAL`, `RUN_PST_REAL` y `RUN_PST_SMOKE_REAL`: 5 suites, 28 pruebas ✔, 0 omitidas.
- `git diff --stat origin/main 30272e6 -- contracts packages`: vacío. No hay cambios en `infra/`.

Cobertura por tarea:
- Tarea 0: `flight-status.spec.ts` y `operations-security.spec.ts` (cancelación y retraso repetidos sin republicar, `FLIGHT_STATUS_NOT_AVAILABLE` vs `UNAVAILABLE`, fecha inválida, campo extra, transición no permitida) e `integration/flight-status.spec.ts` ✔.
- DCS-01: `check-in-dependencies.spec.ts` (adaptadores gRPC reales y tablas) y `dcs-real.spec.ts` ✔.
- DCS-02: `check-in-domain.spec.ts` ✔.
- DCS-03: `check-in-window.spec.ts` (antes, apertura, dentro, cierre y después con reloj fijo); `check-in.spec.ts` (resultado mixto ⇒ COMPLETED con FAILED, cupón ausente ⇒ FAILED, infante, segmentos por ventana); `dcs-real.spec.ts` (asiento CHECKED_IN en Ancillaries, pase QR, entrega `booking.checked_in`); Ajv contra `CheckInResponse` ✔.
- DCS-04: `boarding-passes.spec.ts`, `check-in-dependencies.spec.ts` (pase invalidado ⇒ `BOARDING_PASS_NOT_AVAILABLE`; Ajv contra `BoardingPassListResponse`) ✔.
- DCS-05: `check-in.spec.ts`, `check-in-dependencies.spec.ts`, `dcs-real.spec.ts` (1 pase, 1 delivery, una sola asignación tras repetir) ✔.
- DCS-SEC-01: gRPC real, owner ajeno ⇒ `NOT_FOUND` sin filas, asignaciones ni eventos ✔. DCS-SEC-02: QR `M1/<uuid>/<asiento>` sin documento, correo ni teléfono ✔.
- Cambio en ancillaries (ADR-F10-04), por lectura de código y pruebas: `updateStatus('CONFIRMED')` solo actualiza filas `PROVISIONAL`; `RELEASED` actualiza toda fila no liberada (incluida `CHECKED_IN`); el índice único parcial `WHERE status <> 'RELEASED'` cuenta `CHECKED_IN` como ocupado; `markCheckedIn` filtra por `ownerId` y va después de `assertOwner`; `RELEASED` ⇒ `CHECK_IN_NOT_AVAILABLE`.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- O1 · DCS-03: ninguna prueba cubre `FLIGHT_ALREADY_DEPARTED` (vuelo DEPARTED/ARRIVED/DIVERTED) ni vuelo CANCELLED en check-in (`check-in.ts:39-40`; sin coincidencias en `microservices/operations-service/test`), ni un cupón presente con estado distinto de `ISSUED`. La columna Prueba del plan no los exige.
- O2 · Ancillaries/ADR-F10-04: ninguna prueba afirma que `ConfirmSeats` deje intacto un asiento `CHECKED_IN`, que `ReleaseSeats` lo libere ni que el índice parcial lo cuente como ocupado. El fake `updateStatus` de `anc-06-07-seat-assignments.spec.ts:12` sobrescribe cualquier estado. La prueba `ANC-SEC-02 AssignSeatAtCheckIn` borra antes los asientos de la reserva ajena, por lo que no ejercita `markCheckedIn` con una asignación existente de otro owner.
- O3 · ADR-F10-05: un asiento `RELEASED` hace que Ancillaries devuelva `CHECK_IN_NOT_AVAILABLE`, error que `check-in.ts:80` no incluye entre los fallos por pasajero. Aborta todo el check-in en lugar de marcar ese pasajero como `FAILED`.
- O4 · Idempotencia (ADR-F10-02 y ADR-F10-05): los límites aceptados son razonables para doble pase y doble asiento, pero dejan riesgos reales de otro tipo.
  - Doble boarding pass y asiento doble: sin riesgo real. Lo impiden `check_ins_booking_id_key`, `boarding_passes_booking_id_passenger_id_segment_id_key`, `begin`/`resume` atómicos (el concurrente recibe `CHECK_IN_NOT_AVAILABLE`), el índice único de Ancillaries por (reserva, pasajero, segmento) y el índice parcial de asiento activo.
  - Doble `booking.checked_in`: posible solo si Webhooks recibe el evento y la respuesta se pierde, porque entonces el reintento publica de nuevo (`check-in.ts:88-93`). Riesgo acotado, dado que el protocolo no tiene clave de idempotencia.
  - Evento perdido: si el proceso muere entre `complete` y `publish` (`check-in.ts:87-88`), el check-in queda COMPLETED y los reintentos devuelven el resultado previo sin publicar.
  - Check-in bloqueado: si el proceso muere en `IN_PROGRESS`, `find` devuelve un registro sin resultado y toda llamada posterior da `CHECK_IN_NOT_AVAILABLE` (`check-in.ts:30`), sin recuperación. Es el riesgo más relevante.
  - Dos cancelaciones concurrentes de un mismo vuelo pueden publicar `flight.cancelled` dos veces (RPC solo admin; ADR-F10-02 lo reconoce).
- O5 · Bitácora `2026-10-17_dev_F10_1.md`, sección "Verificaciones del humano": los conteos de pruebas quedaron como marcadores `<N>` sin completar.
- O6 · `DCS-06` (redeploy y smoke en Cloud Run) pendiente, por indicación de la auditoría de código. Ancillaries y operations deben redesplegarse antes de ese smoke.
- O7 · `anc-10-real.spec.ts` queda omitida sin `RUN_ANC10_REAL`; no se ejecutó por no ser de F10.
