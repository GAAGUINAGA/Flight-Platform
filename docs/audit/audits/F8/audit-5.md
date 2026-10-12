# Auditoría F8 — #5
- Fecha: 2026-10-12 · Commit auditado: b9e67e4 · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Alcance: corrección acotada `fix/F8-smoke` (b9e67e4), clon `C:\Proyectos\fp-audit`. H1 de audit-4 resuelto: `reservation-security.spec.ts` agrega `it.each` que rechaza `MALE`, `FEMALE`, `OTHER`, `m` y `''` con `INVALID_ARGUMENT`/`VALIDATION_FAILED` sin invocar el caso de uso, y acepta `M`, `F`, `X` verificando que el valor llega al caso de uso. Comparación de `PassengerItem` (`vuelos-openapi.yaml:1142-1225`) con `passengerSchema` (`reservation.controller.ts:12`): enums (`passengerType`, `documentType`, `gender` = `M|F|X`), campos requeridos, formatos `date` y estructura de `contact`, `assignedSeats` y `extraBaggage` coinciden; las restricciones adicionales (longitudes, formato de documento, email, E.164, uuid, `quantity` 1–3) no contradicen el contrato y las exige RSV-SEC-01. `smoke-payload-grpc.spec.ts` envía por gRPC real el mismo payload que `scripts/smoke.cjs` (gender `X`) y es aceptado. El smoke (`smoke.cjs:11-12`) solo imprime `code` numérico y `details` si cumple `^[A-Z_]+$` (si no, `REDACTED`); no imprime la llave ni datos de pasajero.

Comandos: `npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration` → 9 suites / 48 verdes; `npm run lint` → sin errores; `npx jest microservices/reservation-service --runInBand --verbose` → 13 suites / 57 verdes, 4 omitidas (RSV-12 opt-in); `RUN_RSV12_REAL=true npx jest .../rsv-12-real.spec.ts --runInBand` → 4/4 verdes. Suite raíz `npx jest --runInBand --forceExit --testTimeout=30000`: 42 suites verdes, 12 fallan (ver Observaciones); sin `--forceExit` no terminó en más de 30 min y se detuvo.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- Suite raíz en un solo proceso: fallan `rsv-11-postgres.spec.ts` y `reservation-owner-prisma.spec.ts` (`The table inventory.reservations does not exist`) porque una suite previa deja `DATABASE_URL` de otro servicio y el `beforeAll` solo carga el `.env` de Reservation si la variable está vacía (`reservation-owner-prisma.spec.ts:14`); ambas pasan al ejecutar `microservices/reservation-service` solo.
- Suite raíz: otras 10 suites fallan fuera de Reservation por entorno del clon (api-gateway `generated/prisma-client`, inventory, pricing, operations, webhooks).
- `rsv-12-real.spec.ts` y `rsv-07-10.spec.ts` ya usan `M`/`F`; `queries.ts:7` conserva la conversión `MALE/FEMALE/OTHER → M/F/X` en lectura, sin uso.
- No hay prueba automatizada de la salida del smoke (`code`/`details`).
- El smoke contra Cloud Run (RSV-13) requiere el redeploy posterior; fuera de esta auditoría de código.
