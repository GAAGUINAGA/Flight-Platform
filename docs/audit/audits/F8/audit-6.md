# Auditoría F8 — #6
- Fecha: 2026-10-12 · Commit auditado: a235714 · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Alcance: corrección acotada `fix/F8-create-real` (a235714, ADR-F8-03), clon `C:\Proyectos\fp-audit`. No se audita de nuevo el resto de F8 (audit-2 y audit-5).

1. Escenario nuevo de RSV-12 (`rsv-12-real.spec.ts:147-171`): arma `CreateReservation` con `GrpcPricingGateway`, `GrpcInventoryGateway`, `GrpcAncillariesGateway`, `GrpcTicketingGateway`, `GrpcEventPublisher` y `FakePaymentVerifier`, las mismas clases y el mismo orden de constructor que `main.ts:23-28`; `createReservationServer` recibe las mismas `deps` que `main.ts:29`. Envía por gRPC real (cliente cargado del proto) owner `smoke-<uuid>` (no UUID), metadata `x-internal-key`/`x-owner-id`/`x-role=system`, un pasajero con `assignedSeats: []` y `extraBaggage: []`, y verifica la fila persistida. Sin la corrección el desarrollador reportó `3 INVALID_ARGUMENT: VALIDATION_FAILED` (bitácora dev F8 #9).
2. `ownerId` no se valida como UUID: `reservation.controller.ts` solo usa `uuid()` en `holdId`, `bookingId`, `associatedAdultId`, `segmentId` e `itineraryId`; `ownerId` se toma de la metadata y se descarta del cuerpo (`requested`, línea 17). Sin `uuid` sobre owner en `application/` ni en `shared/src/security.ts`; columna `owner_id` es `VarChar(128)`.
3. Log de validación (`reservation.controller.ts:24-25`): `fields=` con rutas de campos de las issues de Zod, sin valores; en la ejecución solo se vieron `holdId,passengers,payment.paymentReference,idempotencyKey` y `passengers.0.gender`.
4. Contrato: `contracts/openapi/` sin cambios en el commit; `GetOfferHold` extendido solo de forma aditiva en el proto interno (`pricing.proto`, ADR-F8-03).

Comandos (clon en a235714):
- `npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration` → 9 suites / 48 verdes.
- `npm run lint` → sin errores ni advertencias.
- `npx jest microservices/reservation-service --runInBand --verbose` → 13 suites / 57 verdes, 5 omitidas (RSV-12 opt-in).
- `RUN_RSV12_REAL=true npx jest microservices/reservation-service/test/integration/rsv-12-real.spec.ts --runInBand --verbose` → 5/5 verdes.
- `npx jest microservices/pricing-service/test --runInBand --testPathIgnorePatterns=integration` → 4 suites / 16 verdes (Pricing fue tocado por el commit).

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- El escenario nuevo de RSV-12 no replica byte a byte el payload/metadata del smoke: pasajero con `gender: 'M'`, nombres/documento propios (el smoke usa `gender: 'X'`, `SMOKE123`), sin `x-correlation-id`, y el `holdOffer` va con rol `customer` (el smoke usa `system`). `smoke-payload-grpc.spec.ts` cubre el payload exacto del smoke solo a nivel de controlador.
- El rechazo de `getHold` por respuesta incompleta (`grpc-gateways.ts`, `VALIDATION_FAILED`) no tiene prueba propia.
- `npm audit`: 22 vulnerabilidades moderadas preexistentes según la bitácora del developer; no se re-ejecutó en esta auditoría.
- El smoke contra Cloud Run (RSV-13) requiere el redeploy posterior; fuera de esta auditoría de código.
