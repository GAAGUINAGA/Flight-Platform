# Auditoría F11 — #3
- Fecha: 2026-10-22 · Commit auditado: f7467fa (código; encima solo documentación hasta 9dddb4a) · Veredicto: RECHAZADO
- Alcance: entrega F11b (tarea 0, PLT-E OP-09 a OP-14, PLT-F OP-20 a OP-22, J5 y J6 sin admin). Clon `C:\Proyectos\fp-audit`, rama `feat/F11b-postventa-checkin`, Postgres local 127.0.0.1:15432. Informes previos: audit-1 y audit-2 (APROBADO, F11a).
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor:
- `npm run lint`: sin errores ni advertencias.
- Build de `@flight-platform/api-gateway` y `@flight-platform/reservation-service`: correctos. `npm audit --audit-level=high`: exit 0 (22 moderate, ninguna high).
- CI del gateway (`npx jest platform/api-gateway/src --runInBand`): 3 suites, 46/46.
- CI de reservation (`npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration`): 20 suites, 91/91.
- Suites completas sin banderas reales: gateway 4 suites aprobadas, 1 omitida (48 aprobadas, 8 omitidas); reservation 24 aprobadas, 1 omitida (101 aprobadas, 19 omitidas).
- `RUN_GATEWAY_REAL=true npx jest platform/api-gateway --runInBand --verbose`, dos veces seguidas: 5/5 suites, 55 aprobadas, 1 `todo` (OP-02, ADR-F11-03), 0 omitidas, 0 fallidas en ambas. `gateway.spec.ts` GW-04/GW-09 pasan (capitalización de ruta correcta).
- `RUN_RSV12_REAL=true RUN_PST_REAL=true RUN_PST_SMOKE_REAL=true npx jest microservices/reservation-service --runInBand --verbose`, dos veces seguidas: 25/25 suites, 120/120, sin omitidas.
- Búsqueda en las salidas completas de las 8 ejecuciones (patrones `eyJ…`, `Bearer …`, `postgres://`, email, nombres, `documentNumber`, `internalApiKey` con valor): 0 coincidencias; `ownerId` e `internalApiKey` aparecen como `[REDACTED]`.
- `git diff --name-only origin/main HEAD -- contracts packages`: vacío. En `microservices/` solo cambia `reservation-service` (`resume-pending.ts`, `deadline-service.ts`, `grpc-gateways.ts`, `filters.ts`, `main.ts` y cuatro pruebas). No hay rama `main` local; se comparó con `origin/main`.

Revisión por tarea:
- Tarea 0: workflow `gateway-ci.yml` ejecuta todo `platform/api-gateway/src` (incluye `partner-issuer.spec.ts` y `openapi-path.spec.ts`); prueba de reserva con hold ajeno ⇒ 404 idéntico al de hold inexistente, sin reserva creada ni hold consumido (`real-stack.e2e.spec.ts:340-345`); listado ajeno no incluye la reserva (`:380-382`); ADR-F11-03 ampliado; limitador con 503 + `Retry-After` (`gateway.spec.ts:62-68`); plazo `GATEWAY_ORCHESTRATION_DEADLINE_MS` (`grpc-clients.ts`), reintento con la misma `Idempotency-Key` tras 503 y cuerpo distinto ⇒ 422 (`:354-364`); Reservation registra `dependency=… operation=… code=…` sin PII (`grpc-gateways.ts:16`, RSV-08), propaga `UNAVAILABLE`/`DEADLINE_EXCEEDED` (`filters.ts`, `dependency-unavailable.spec.ts`) y recupera por `ResumePending` un timeout posterior a la emisión (`rsv-12-real.spec.ts:500-517`). La evaluación de instancia mínima queda en ADR-F11-07 a cargo del humano.
- Cambios en reservation: solo los autorizados (error en frío/plazos/compensación y hold ajeno ⇒ NOT_FOUND). El cambio en `resume-pending.ts` confirma asientos al reanudar la emisión.
- 503: toda salida 503 del gateway pasa por `errors.ts:27` o `security.ts:65` con `RATE_LIMIT_EXCEEDED` y `Retry-After: 5` (`web-errors.ts:31`); probado con limitador (`gateway.spec.ts`), `UNAVAILABLE` y `DEADLINE_EXCEEDED` (`real-stack.e2e.spec.ts:332-339, 354-355`), con cuerpo validado por Ajv. No existe otra ruta de código que emita 503.
- PLT-E (OP-09 a OP-14): las seis rutas con scope correcto, `Idempotent` en OP-10/12/14; bucle `real-stack.e2e.spec.ts:395-420` prueba 401, 403 (scope ajeno), 404 (otro sub), 400 y redacción de logs en cada una; K con Ajv de `BaggageOptionsResponse`, `BaggageAddedResponse`, `DateChangeSearchResponse`, `BookingDetail`, `CancellationQuoteResponse`; 202 sin cuerpo en cambio y cancelación pendientes, recuperados por `ResumePending` (`:447-475`).
- OP-10 (ADR-F11-09): `pay_pending_*` y `pay_denied_*` ⇒ 422 `PAYMENT_NOT_AUTHORIZED` validado con Ajv, y `baggage-options` sigue con `alreadyPurchased: 0`; luego `pay_ok_*` ⇒ 200 con `totalBaggage: 1` (`:424-433`). Condición del humano cumplida.
- PLT-F (OP-20 a OP-22): K con `CheckInResponse`, `BoardingPassListResponse`, `FlightStatus`; 401/403/404/400 y redacción en OP-20/21; OP-22 pública con 200/404/400 (`:221-273`). El smoke `render-f11b-smoke.cjs` corre dentro del e2e y devuelve las 15 líneas esperadas, sin imprimir el token.
- J5/J6: compra, equipaje (200 con efecto verificado por `baggage-options`), cambio de fecha (itinerario nuevo en `BookingDetail`), cancelación (estado `CANCELLED` en persistencia y entregas `booking.baggage_added`, `booking.changed`, `booking.cancelled`), check-in con `CHECKED_IN` y boarding pass con `seat` y `segmentId`.
- Contrato: respuestas 200/202/409/410/422/404 conformes a `vuelos-openapi.yaml:274-656`. OP-10 solo responde 200 (el contrato también admite 202), decisión del humano en ADR-F11-09.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| 1 | Tarea 0 / PLT-B (S) | `platform/api-gateway/test/e2e/real-stack.e2e.spec.ts:180-183, 322`; `BACKLOG.md:65`; `audit-1.md` O2 | No existe prueba REST de `DELETE /offers/hold/{holdId}` (OP-05) con el hold de otro sub ⇒ 404: las únicas llamadas `delete(` son anónimo (401), scope `flights:read` (403) y el dueño (204). `grep "\.delete\("` en `platform/api-gateway` no devuelve otra. La bitácora `2026-10-22_dev_F11_1.md:14` solo declara aserciones de hold y listado ajenos para reserva. |
## Observaciones (no bloquean → BACKLOG)
- O1 (J5, PLT-I5): el e2e del gateway no afirma tickets reemitidos tras el cambio de fecha (`real-stack.e2e.spec.ts:440-442` solo comprueba el itinerario en `BookingDetail`) ni recursos liberados tras la cancelación (`:457-459` solo estado `CANCELLED` y webhooks). Esos efectos sí se verifican contra servicios reales en `rsv-12-real.spec.ts:349-359` y `:405-409`, que pasan.
- O2 (ADR-F11-06): el ADR dice que se exceptúa solo el 404 no declarado de `POST /bookings`, pero `app.ts:83` tolera cualquier estado 400/401/403/404/409/410/422/429/503 no declarado en cualquier operación si el cuerpo cumple `ProblemDetails`.
- O3 (tarea 0): sigue sin prueba con token `partner` contra rutas REST (audit-1 O4; `BACKLOG.md:67`, pospuesto a F11c junto con webhooks).
- O4 (tarea 0, registro de dependencias): `createHold`, `releaseReservedInventory`, `purchaseBaggage`, `voidTickets`, `reissueTickets` y `refundTickets` (`grpc-gateways.ts:24, 25, 64, 69, 71, 72`) no pasan por `readDependency`, así que un fallo ahí no registra dependencia ni código gRPC.
- O5 (documentación): la fila de verificación del humano en `2026-10-22_dev_F11_2.md:285` conserva el texto sin completar `<sí o no>` sobre migraciones del gateway (el esquema usa `status String`; no hay migración nueva). Además `:47` y la lista `--verbose` (`:84-85`) describen aún el 503 con `VALIDATION_FAILED`, ya anulado por el ajuste de `:53-57`.
- O6 (OP-10, ADR-F11-09): sin señal de estado pendiente en `reservation.proto`, el 202 de equipaje del contrato no se emite nunca; aceptado por el humano.
- O7 (despliegue): el smoke de J5/J6 contra Render y las imágenes Docker solo están evidenciados por el humano; el auditor no los reprodujo (por instrucción).
