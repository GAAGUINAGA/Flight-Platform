# Auditoría F8 — #4
- Fecha: 2026-10-12 · Commit auditado: 719a714 · Veredicto: RECHAZADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Alcance: corrección acotada de `fix/F8-smoke` (61a4657 + 719a714), clon `C:\Proyectos\fp-audit`. Comandos: `npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration` (9 suites / 40 verdes); `npm run lint` sin errores; `npx jest microservices/reservation-service --runInBand --verbose` (13 suites / 49 verdes, 4 omitidas = RSV-12 opt-in; incluye `smoke-payload-grpc.spec.ts` 1/1); `RUN_RSV12_REAL=true npx jest .../rsv-12-real.spec.ts --runInBand` (4/4 verdes). `npx jest --runInBand` desde la raíz del clon falla fuera de Reservation por entorno del clon (`platform/api-gateway`: `Cannot find module '../generated/prisma-client'`; inventory: `ticketing.reserved_inventory does not exist`; pricing: `permission denied for schema pricing`); no se atribuye a este cambio. Comparación de `PassengerItem` (`vuelos-openapi.yaml:1142-1225`) con `passengerSchema` (`reservation.controller.ts:12`): `gender` = `M|F|X` (coincide); `passengerType`, `documentType`, requeridos, `birthDate`/`documentExpiryDate` (date), `assignedSeats` y `extraBaggage` coinciden; las restricciones adicionales (nombres 1–50, documento 5–20 alfanumérico, email, teléfono E.164, uuid, `quantity` 1–3) no están en el OpenAPI y las exige PLAN RSV-SEC-01. El smoke (`scripts/smoke.cjs:12-13`) solo imprime `code` numérico y `details` si cumple `^[A-Z_]+$` (si no, `REDACTED`); no imprime la llave ni datos de pasajero.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| 1 | RSV-SEC-01 / RSV-13 (corrección gender) | `reservation.controller.ts:12`; búsqueda de `gender` en `microservices/reservation-service/test/` | Ninguna prueba verifica que `gender` rechace valores fuera de `M/F/X` (p. ej. `MALE`, `OTHER`, `m`) ni que acepte `M`; solo hay casos válidos `X` (`smoke-payload-grpc.spec.ts:11`) y `F` (`reservation-security.spec.ts:22`). |

## Observaciones (no bloquean → BACKLOG)
- `rsv-07-10.spec.ts:12` y `rsv-12-real.spec.ts:92` siguen usando `gender: 'FEMALE'` / `'MALE'` (valores no contractuales); pasan porque invocan los casos de uso sin pasar por el schema del controlador.
- `queries.ts:7` conserva la conversión `MALE/FEMALE/OTHER → M/F/X` en lectura, sin uso tras alinear la validación.
- La bitácora dev F8 #7 cita "Commit final: 2add5f4", que no existe en la historia de `fix/F8-smoke` (el commit es 61a4657).
- No hay prueba automatizada de la salida del smoke (`code`/`details`); solo `node --check` según la bitácora.
- El smoke contra Cloud Run (RSV-13) requiere el redeploy posterior; fuera de esta auditoría de código.
