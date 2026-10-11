# Auditoría F6 — #1
- Fecha: 2026-10-11 · Commit auditado: 8a87bd3 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos en el clon `C:\Proyectos\fp-audit` (commit 8a87bd3): `npm run lint` (0 avisos); `npx jest microservices/operations-service --runInBand` (6 suites, 13 pruebas pasan); `npx jest packages/shared --runInBand` (11 pruebas pasan); `git diff origin/main --stat -- packages/ contracts/` sin cambios, por lo que no se ejecutan las demás suites; `docker build` de `microservices/operations-service/Dockerfile` OK y `docker run --rm` con `PORT=8080`: sin llave `UNAUTHENTICATED`, con llave `SERVING`. OPS-06 (Cloud Run) excluido por indicación de la auditoría de código.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- OPS-04: el comportamiento "vuelo inexistente ⇒ `FLIGHT_STATUS_NOT_AVAILABLE`" (`src/application/flight-status.ts:5`) no tiene prueba propia; la prueba de la tarea solo cubre la creación perezosa.
- OPS-04: cualquier fallo de Inventory (incluida una caída) se convierte en `FLIGHT_STATUS_NOT_AVAILABLE` (`flight-status.ts:5`, `catch` sin distinguir).
- OPS-SEC-01: la prueba S (`test/security/operations-security.spec.ts:85`) cubre solo `flightNumber` inválido; fecha inválida, campo extra y transición no permitida por RPC no tienen caso S.
- OPS-SEC-02: la redacción de logs se prueba con una llamada directa al logger (`operations-security.spec.ts:96`), no con el log emitido por una operación.
- OPS-03: `transition` acepta el mismo estado (`operational-flight.ts:6`), incluido `ARRIVED → ARRIVED` y `CANCELLED → CANCELLED`; repetir una cancelación vuelve a cerrar el vuelo y a publicar `flight.cancelled`. Sin prueba.
- OPS-05: cualquier actualización posterior con retraso ≥ 15 min (aunque el estado no cambie) vuelve a publicar `flight.schedule_changed` (`flight-status.ts:6`).
- Bitácora dev F6 #2 figura en estado `en curso` con commit final a69b33f; se auditó 8a87bd3 según indicación expresa.
- `ReservationGateway` falso por diseño (F8); no es hallazgo.
