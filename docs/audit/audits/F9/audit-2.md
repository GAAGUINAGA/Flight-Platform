# Auditoría F9 — #2
- Fecha: 2026-10-17 · Commit auditado: 44d332f · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle de lo ejecutado (clon `C:\Proyectos\fp-audit`, rama `audit/F9-2` en `e6f42b0`; contra 44d332f solo cambia `docs/dev/progress/2026-10-17_dev_F9_3.md`):
- `npm run lint`: exit 0. `npm run build` (todos los workspaces): exit 0. `npm audit --audit-level=high`: exit 0.
- CI reservation (`--testPathIgnorePatterns=integration`): 17 suites, 85/85. CI ancillaries: 10 suites, 19/19 (14/14 con el filtro `(integration|security)` del workflow).
- Suites completas: reservation 95 pasan + 17 opt-in omitidas; ancillaries 32 pasan + 1 omitida (ninguna borrada).
- `RUN_RSV12_REAL=true RUN_PST_REAL=true` sobre `rsv-12-real.spec.ts`: ejecución 1 → 17/17; ejecución 2 (seguida) → 17/17.
- CI con el comando de cada workflow: inventory 17, pricing 10, ticketing 3, webhooks 3, operations 7, api-gateway 43: todas pasan.
- `npm run gen:contracts`: exit 0; los 9 archivos generados son idénticos byte a byte a HEAD (`cmp` y `git hash-object`); `git diff` vacío; `.gitattributes` fija LF.
- `git diff f2335c7 44d332f` sobre `microservices/{inventory,pricing,ticketing,ancillaries}-service`, `platform/` y `packages/`: vacío (la corrección está solo en reservation-service).

Hallazgos de audit-1:
- H1 (PST-06): resuelto. `pst-05-06-cancellation.spec.ts:73-81` hace vencer el quote sobre reserva `CONFIRMED`, espera `QUOTE_EXPIRED` y afirma estado/hold sin cambios, cero reembolsos y cero liberaciones; gateway mapea `QUOTE_EXPIRED` ⇒ 409 (`errors.ts:20`). La real PST-07 afirma `QUOTE_EXPIRED` en el perdedor (`rsv-12-real.spec.ts:386`).
- H2 (PST-04): resuelto. `pst-04-date-change-confirm.spec.ts:61-66` (`CHANGE_OFFER_EXPIRED`, sin cambios); gateway ⇒ 410 (`errors.ts:19`, `gateway.spec.ts:63`); la real PST-07 afirma `CHANGE_OFFER_EXPIRED` en el perdedor (`rsv-12-real.spec.ts:404`) y una sola oferta usada.
- H3 (PST-04): resuelto. Unitaria con `assignedSeats` no vacío, orden `release-old`→`consume-new`, `releaseAll`, `reserveSeats` y `reissue` contados (`:33-45`). Real (`rsv-12-real.spec.ts:305-322`) lee inventory (`sold` anterior −1, nuevo +1, hold `CONSUMED`), ancillaries (asiento anterior sin filas activas, nuevo reservado) y ticketing (`VOIDED` e `ISSUED`).
- H4 (PST-06): resuelto. Unitaria cuenta `releaseAll` (`:42`); real (`rsv-12-real.spec.ts:360-372`) lee `reservedInventory` liberado, `sold` restituido, asiento y equipaje `RELEASED` y tickets `VOIDED/REFUNDED`.

Correcciones pedidas por el humano:
- `resumeCancellation` (O1): prueba `pst-05-06-cancellation.spec.ts:46-64` (falla en `TICKETS_SETTLED`, no reanuda; luego reanuda y deja `CANCELLED`).
- ADR-F9-05: existe; `ancillaries-postgres.spec.ts:99-104` (ReleaseSeats/ReleaseAll) y `:96-98` (ConfirmSeats ⇒ `updateStatus`) por gRPC real con owner ajeno ⇒ `NOT_FOUND` y snapshot de filas intacto; la comprobación de owner precede a la escritura (`seat-assignments.ts:36-37`, `baggage.ts:48`). Pasan.
- Error 1 (sold=0 tras ConfirmDateChange): causa documentada (F9_2, 12:33) coherente con el diff: `releaseReservedInventory` se ejecutaba después de `consumeHold` y liberaba también el hold nuevo; la corrección está en `confirm-date-change.ts` y `resume-pending.ts` (reservation) y la real lee `sold` del vuelo nuevo.
- Error 2 (BASIC ⇒ `INTERNAL_ERROR`): `FARE_NOT_CHANGEABLE` (409) en `post-sale-date-change.ts:18` y `confirm-date-change.ts:35`, después del lookup por owner y antes de cualquier llamada a Pricing/Inventory/Ancillaries/Ticketing; adaptador `grpc-gateways.ts:38-44`. Pruebas: unitarias PST-03 y PST-04 (sin llamadas ni efectos), `grpc-pricing-gateway.spec.ts`, real BASIC (`rsv-12-real.spec.ts:325-345`: Search y Confirm rechazan; reserva, hold, tickets y `changeOffer` sin cambios). PST-SEC-01 real usa BASIC con otro owner y los seis RPC devuelven `NOT_FOUND` (`:408-431`), por lo que el owner se comprueba antes que la regla de tarifa.
- Tarifa por nombre: los helpers reales `changeableFare` y `hold(…, brand)` eligen por `fareBrand` (CLASSIC/FLEX/BASIC). Ver O1 sobre `selectOfferForHold`.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- O1 (tarifa por índice): `test/integration/pricing-hold-fixture.ts:14,20` (`selectOfferForHold`) sigue eligiendo `offers[0]` y `pricingOptions[0]`; lo usan `hold()` sin marca (RSV-12 / smoke) y la prueba real PST-02 (`rsv-12-real.spec.ts:251`, tras buscar la oferta BASIC). También `resume-pending.ts:13` (`pricingOptions?.[0]?.cabinClass` al reservar asientos) y fallback `[0]` en `scripts/post-sale-smoke.cjs:45`. Hoy pasan porque Pricing devuelve ese orden.
- O2 (PST-07): la exclusión por `ownerId+changeOfferId` de `ConfirmDateChange` (`confirm-date-change.ts:20-24`) es en memoria del proceso; entre instancias, el perdedor depende de `markChangeOfferUsed` (`post-sale-pricing.ts:57`), ya tras reclamar y verificar su `paymentReference` (O2 de audit-1, sin cambios).
- O3 (documentación): `docs/dev/progress/2026-10-17_dev_F9_3.md:30` conserva marcadores `<N>` sin rellenar en las verificaciones del humano; `_F9_2.md` cita como commit final `9f2d25f` (el código final es 44d332f).
- O4: de audit-1 siguen vigentes O3 (reutilización de `paymentReference` entre cambio y equipaje solo en el store en memoria), O5 (las reales de cancelación usan CLASSIC sin reembolso; el caso reembolsable solo en unitaria) y O7 (PST-08, redeploy y smoke en Cloud Run, pendiente).
