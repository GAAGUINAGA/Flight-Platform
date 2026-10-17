# Auditoría F8 — #8
- Fecha: 2026-10-16 · Commit auditado: ad3ca91 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- Alcance: `git diff origin/main` en `microservices/`, `packages/` y `contracts/` solo toca `microservices/reservation-service`.
- `npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration`: 10 suites / 58 verdes. `npm run lint`: OK. Suite completa de reservation: 14 suites / 68 verdes, 5 omitidas (RSV-12). `RUN_RSV12_REAL=true` RSV-12: 5/5.
- Regresión: con `src/` de `origin/main` y las pruebas actuales, `rsv-08-dependency-errors.spec.ts` falla 4/6 y RSV-12 falla 1/5; restaurado luego (árbol limpio).
- Owner: `queries.ts` verifica `store.findById(ownerId, bookingId)` antes de consultar Ancillaries; la prueba RSV-08 de owner ajeno confirma NOT_FOUND sin llamar a dependencias.
- NOT_FOUND solo se traduce a vacío para Ancillaries (`getAssignments`/`getBaggageOptions`); Ticketing con código 5 y cualquier otro código fallan y se registran como `dependency=… operation=… code=…` sin PII (probado).
- Create devuelve tickets (`create-reservation.ts`, ADR-F8-05) y el smoke exige `length > 0` y todos ISSUED en Create y Get. La repetición idempotente devuelve la vista persistida sin tickets (documentado en ADR-F8-05).
- No se ejecutó el smoke contra Cloud Run: el despliegue es posterior, desde main.
