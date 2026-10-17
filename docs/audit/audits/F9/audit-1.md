# Auditoría F9 — #1
- Fecha: 2026-10-17 · Commit auditado: d0a8fc0 · Veredicto: RECHAZADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | ✔ |

Detalle de lo ejecutado (clon `C:\Proyectos\fp-audit`, código idéntico a d0a8fc0; sobre él solo hay documentación):
- `npm run lint`: exit 0.
- Build de shared, inventory, pricing, ticketing, webhooks, operations, ancillaries, reservation y api-gateway: exit 0.
- Suites de CI: inventory 17, pricing 10, ticketing 3, webhooks 3, operations 7, ancillaries 19, reservation 79 (16 suites) y api-gateway 43: todas pasan.
- Suites completas: ancillaries 32 pasan + 1 omitida (33; eran 30 al cierre de F7, ninguna borrada, +2 nuevas); reservation 89 pasan + 16 omitidas (opt-in).
- `RUN_RSV12_REAL=true RUN_PST_REAL=true` sobre `rsv-12-real.spec.ts`: 16/16 pasan.
- Contrato gRPC: `common.proto` (`ExtraBaggage.passenger_id = 3`, `BaggageOption.checked_baggage_included = 6`) y `ancillaries.proto` solo añaden campos y un RPC; `contracts/openapi/` sin cambios. `npm run gen:contracts` regenera el código versionado sin diferencias de contenido.
- Seguridad: owner ajeno ⇒ NOT_FOUND en los seis RPC (real), Zod de cantidad/fecha/ids (real), `paymentReference` inicial no reutilizable en equipaje (real), claim atómico de referencias (unitaria), ANC-SEC-02 y suite `security` de ancillaries (5) verdes.
- Respuestas validadas con Ajv contra el OpenAPI en ejecución: `BaggageOptionsResponse`, `BaggageAddedResponse`, `DateChangeSearchResponse`, `CancellationQuoteResponse`, `BookingDetail`.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | PST-06 | `microservices/reservation-service/src/application/post-sale-cancellation.ts:31` · `test/pst-05-06-cancellation.spec.ts:45-50` · `grep QUOTE_EXPIRED microservices/reservation-service/test` ⇒ 0 resultados | La prueba exigida "quote expirado ⇒ `QUOTE_EXPIRED`" no existe: ninguna prueba de Reservation hace vencer un quote ni espera `QUOTE_EXPIRED`. La prueba "quote vencido o ya usado" repite `cancel` sobre una reserva ya `CANCELLED` y espera `BOOKING_NOT_CONFIRMED`; `MemoryQuotes` solo usa `expiresAt` futuro. |
| H2 | PST-04 | `microservices/reservation-service/src/application/confirm-date-change.ts:33` · `grep CHANGE_OFFER_EXPIRED microservices/reservation-service/test` ⇒ 0 resultados | La prueba exigida "`CHANGE_OFFER_EXPIRED` ⇒ 410" no existe en Reservation: ninguna prueba de `ConfirmDateChange` usa una oferta vencida o ya usada. En `rsv-12-real.spec.ts:292-307` (PST-07) el perdedor solo se comprueba como `rejected`, sin verificar su código. |
| H3 | PST-04 | `test/pst-04-date-change-confirm.spec.ts:31-39` · `test/integration/rsv-12-real.spec.ts:243-263` · `src/application/confirm-date-change.ts:64-69` | La prueba "cambio completo" no afirma todos los efectos de la tarea: `assignedSeats` es `[]` en todas las pruebas (la reserva de asientos nunca se ejecuta); `reissueTickets` no se cuenta ni se verifica; la prueba real solo comprueba estado y filas de `ReservationChange`, sin leer inventario (nuevo hold `CONSUMED`, anterior liberado), asientos ni tickets reemitidos. |
| H4 | PST-06 | `test/pst-05-06-cancellation.spec.ts:37-43` · `test/integration/rsv-12-real.spec.ts:264-279` | La prueba "cancelación completa" no afirma la liberación de Ancillaries (`releaseAll` no se cuenta ni se verifica en ninguna prueba) y la prueba real no consulta inventario ni asientos/equipaje tras cancelar; solo estado `CANCELLED`, un ticket `VOIDED/REFUNDED` y un webhook. El ítem del checklist "inventario, asientos y tickets coherentes" no queda demostrado para cambio ni cancelación. |

## Observaciones (no bloquean → BACKLOG)
- O1 (PST-06): `ResumePending.resumeCancellation` (`resume-pending.ts:18-28`) no tiene prueba; la reanudación del cambio solo se prueba desde el paso `OLD_INVENTORY_RELEASED`.
- O2 (PST-04/PST-07): el perdedor de una carrera por el mismo `changeOfferId` ya ha reclamado y verificado su `paymentReference` antes de `markChangeOfferUsed` (`confirm-date-change.ts:36-42`); no se anula el pago al recibir `CHANGE_OFFER_EXPIRED`.
- O3 (PST-SEC-02): la prueba real cubre solo referencia inicial ⇒ equipaje; la reutilización entre cambio y equipaje se cubre únicamente en el store en memoria.
- O4 (tarea 0): `release` y `updateStatus` de Ancillaries dejaron de lanzar `NOT_FOUND` cuando no hay filas (`prisma-baggage.ts`, `prisma-seat-assignments.ts`); cambio de comportamiento de F7 no cubierto por los ADR-F9-01..04.
- O5 (PST-06): las pruebas reales usan CLASSIC con reembolso cero; el caso reembolsable (Q-033) solo se prueba en unitaria (`pst-05-06-cancellation.spec.ts:37-43`, reembolso 80.00, tickets `REFUNDED`).
- O6: la bitácora dev del 17 reporta Ancillaries 9 suites/14 pruebas; con el comando de CI indicado se ejecutan 10/19 (incluye `security`).
- O7: PST-08 (redeploy y smoke en Cloud Run) pendiente; no bloquea esta auditoría de código.
