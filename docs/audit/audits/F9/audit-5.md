# Auditoría F9 — #5
- Fecha: 2026-10-17 · Commit auditado: 3af191c · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Alcance: solo la corrección acotada del smoke de postventa (`docs/dev/progress/2026-10-17_dev_F9_5.md`); el resto de F9 quedó aprobado en audit-2 y audit-3.

Detalle de lo ejecutado (checkout `--detach 3af191c`; clon con `npm ci`, clientes Prisma generados y Postgres local):
- Alcance del commit: `git diff --stat origin/main 3af191c -- microservices contracts packages` muestra solo `microservices/reservation-service/scripts/post-sale-smoke.cjs` y `microservices/reservation-service/test/integration/rsv-12-real.spec.ts`; nada en `src/`, `contracts/` ni `packages/`. El resto del commit es la bitácora del developer.
- Formas de respuesta (`post-sale-smoke.cjs` vs `reservation.proto`/`common.proto`): `GetBaggageOptions` → `BaggageOptionsResponse{options}` (línea 56-57 lee `.options`); `AddBaggage` → `BaggageAddedResponse{passengerId, totalBaggage}` (línea 61); `SearchDateChange` → `DateChangeSearchResponse{offers[].changeOfferId}` (líneas 69-70); `ConfirmDateChange` y `CancelReservation` → `BookingDetail{bookingId, status}` (líneas 74, 79); `GetCancellationQuote` → `CancellationQuote{quoteId}` (línea 75).
- Tarifa (líneas 43-47): se elige por `fareRules.isChangeable === true` o, sin `fareRules`, por `fareBrand` CLASSIC/FLEX; sin coincidencia no hay caída a la posición y `HoldOffer` falla con `NO_CHANGEABLE_FARE` / "no changeable fare available".
- Prueba opt-in `PST-SMOKE / I` (`rsv-12-real.spec.ts`): ejecuta `post-sale-smoke.cjs` con `node` contra los servicios en proceso y exige exactamente las 10 líneas `OK`; con `-t "PST-SMOKE"` y la variable nueva pasa; sin `RUN_PST_SMOKE_REAL` queda omitida.
- `npm run lint`: exit 0, sin advertencias.
- CI reservation (`npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration`): 18 suites, 86/86. Suite completa: 96 pasan (+18 opt-in omitidas).
- `RUN_RSV12_REAL=true RUN_PST_REAL=true RUN_PST_SMOKE_REAL=true npx jest microservices/reservation-service/test/integration --runInBand --verbose`, dos ejecuciones seguidas: 5 suites, 28/28 y 28/28.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
1. La bitácora `2026-10-17_dev_F9_5.md` en el commit auditado termina con Estado "en curso" y "Commit final: pendiente"; los commits posteriores (`574eab3`, `7157997`) la cierran y no se auditaron.
2. La bitácora cita 18/18 en la suite real; en esta auditoría la carpeta `integration` completa da 28/28 (sin fallos).
3. La prueba usa el puerto fijo 29661 para el Pricing en proceso.
4. Los `warn` `VALIDATION_FAILED` que aparecen durante las pruebas reales corresponden a casos negativos de entrada inválida esperados.
5. El árbol de trabajo del clon tenía 9 archivos generados de `packages/contracts` modificados antes de la auditoría; no forman parte del commit y no se tocaron.
