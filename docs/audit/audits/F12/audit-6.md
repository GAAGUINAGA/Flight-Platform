# Auditoría F12 — #6
- Fecha: 2026-11-06 · Commit auditado: 0a83a70bd9d1c98756b9af183c2f7dde3345c9b4 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ `search-path`: 6 suites/7 pruebas; reloj simulado: 10; ancillaries 59/59 ×2; reservation real 214/214 ×2; inventory 84/84 ×2; ticketing 28/28 ×2; webhooks 63/63 ×2; gateway real con ESB 37 suites/863 aprobadas/1 `todo` ×2, sin `--forceExit`. |
| Pruebas de seguridad | ✔ Suites de seguridad incluidas en las corridas completas; `npm run lint` y `node scripts/audit-policy.cjs` pasaron. |
| Checklist de cierre | ✔ Seis workflows afectados ejecutados uno a uno en clon limpio `C:\Proyectos\fp-audit-ci-fix` (`npm ci`, Prisma, lint, builds, unitarias y política): todos rc=0. Imágenes Docker compiladas por el humano; auditoría de despliegue reservada para audit-7. Sin cambios en `contracts/` ni migraciones. |
| Conformidad con el contrato | ✔ Suites v1/v2 del gateway y validación OpenAPI verdes; los cambios de esta rama no alteran respuestas públicas. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
1. Verificador SQL: `scripts/check-raw-sql.cjs:41-55`; `unqualifiedTables('SELECT * FROM inventory.holds h, booking_owners b')` devuelve `[]`: omite la segunda tabla separada por coma.
2. Purga local: `scripts/local-platform/purge-test-flights.cjs:31,47-49`; un hold con un vuelo de prueba y otro vuelo conserva su línea ajena, pero la purga borra su `price_lock` completo.
