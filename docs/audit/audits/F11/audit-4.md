# Auditoría F11 — #4
- Fecha: 2026-10-23 · Commit auditado: 1a69b91 (código; 4288089 corrige y 1a69b91 solo separa pruebas; encima solo documentación hasta 2bbb7ee) · Veredicto: APROBADO
- Alcance: auditoría de código #2 de la entrega F11b. Clon `C:\Proyectos\fp-audit`, rama `feat/F11b-postventa-checkin`, Postgres local 127.0.0.1:15432. Informe previo: audit-3 (RECHAZADO, hallazgo 1 = H1). El resto de F11b no se vuelve a auditar.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor:
- `npm run lint`: exit 0. Builds de `@flight-platform/api-gateway` y `@flight-platform/reservation-service`: exit 0. `npm audit --audit-level=high`: exit 0.
- CI del gateway (`npx jest platform/api-gateway/src --runInBand`): 3 suites, 46/46. CI de reservation (`npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration`): 20 suites, 97/97.
- `RUN_GATEWAY_REAL=true npx jest platform/api-gateway --runInBand`, dos veces seguidas: 5/5 suites, 58 aprobadas, 1 `todo` (OP-02, ADR-F11-03), 0 omitidas, 0 fallidas en ambas.
- `RUN_RSV12_REAL=true RUN_PST_REAL=true RUN_PST_SMOKE_REAL=true npx jest microservices/reservation-service --runInBand`: 5 ejecuciones completas; 4 con 25/25 suites y 126/126 (incluidas dos consecutivas), 1 con 125/126 (ver O1). Además `rsv-12-real.spec.ts` sola, 3 veces: 19/19 en todas.
- Búsqueda en las salidas completas (tokens `eyJ…`, `Bearer …`, `postgres://`, email y documento de prueba, `internalApiKey` con valor): 0 coincidencias.
- `git diff --name-only origin/main HEAD -- contracts packages`: vacío. `git diff --stat 91466d5 HEAD`: solo `real-stack.e2e.spec.ts` (gateway), `grpc-gateways.ts` y `rsv-08-dependency-errors.spec.ts` (reservation) y bitácoras; ningún otro microservicio.

Verificación de audit-3:
- H1 (OP-05 con hold ajeno): resuelto. `real-stack.e2e.spec.ts:554` (`OP-05 / S: …`, escenario `foreign-hold`) ejecuta `DELETE /offers/hold/{holdId}` con otro sub (`:324`) ⇒ 404 validado con Ajv (`ProblemDetails`) y mismo `code` que el GET ajeno (`:325-326`); el hold sigue `HELD` con `ownerId` del dueño en la base de Inventory (`:327`) y por `GET` con el dueño ⇒ 200 `HELD` validado con `HoldStatusResponse` (`:328-329`). Caso propio, aprobado en las dos ejecuciones.
- O1 de audit-3 (J5 por REST): `:555` (`PLT-I5 / E`, `changed-tickets`): detalle `CONFIRMED` con vuelo nuevo, tickets anteriores `VOIDED`, nuevos `ISSUED`, uno leído por OP-19 con `Ticket` validado (`:457-471`). `:556` (`cancelled-tickets`): detalle `CANCELLED`, todos los tickets `REFUNDED` o `VOIDED` (`:490-498`). Casos propios, aprobados.
- O4 de audit-3 (registro de dependencias): las seis llamadas (`createHold`, `releaseReservedInventory`, `purchaseBaggage`, `voidTickets`, `reissueTickets`, `refundTickets`) pasan por `readDependency` (`grpc-gateways.ts:24, 25, 64, 69, 71, 72`); `rsv-08-dependency-errors.spec.ts:45-58` prueba cada una con gRPC 14 o 4: el error se propaga, se registra `dependency=… operation=… code=…` y el log no contiene PII ni owner/booking. Aprobado.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- O1 (PST-03/04, `rsv-12-real.spec.ts:320`): en la segunda ejecución completa de reservation, `PST-03/04 / I: busca y confirma cambio…` falló por `Exceeded timeout of 5000 ms` (6252 ms). No se reprodujo en las otras 4 ejecuciones completas ni en 3 aisladas (típico 1,2–1,5 s); el archivo no cambia en este commit y el `it` no declara plazo propio (usa el de 5 s por defecto).
- O2 (documentación/pruebas): los nombres de los tres `it` nuevos (`real-stack.e2e.spec.ts:554-556`) y su copia en la bitácora contienen `?` en lugar de `⇒`, `ú` y `ó` («due?o», «cancelaci?n»); los ID `OP-05 / S` y `PLT-I5 / E` están presentes.
- O3 (ADR-F11-06): sigue pendiente la observación O2 de audit-3 (`app.ts:83` tolera estados no declarados distintos del 404 de `POST /bookings`).
- O4 (tarea 0): sigue sin prueba con token `partner` contra rutas REST (`BACKLOG.md:67`, pospuesto a F11c).
- O5 (despliegue): el contenedor de reservation y el smoke contra Render solo están evidenciados por el humano; el auditor no los reprodujo (por instrucción).
