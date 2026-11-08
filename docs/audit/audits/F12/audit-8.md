# Auditoría F12 — #8
- Fecha: 2026-11-07 · Commit auditado: 2e12b343b90f24b4565e0d6ff16c00c1edd13744 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Shared 28; inventory 92, pricing 57 (PRC-12 incluida), operations 88, reservation 217 y gateway real 868 aprobadas/1 `todo`, cada suite real dos veces, sin `--forceExit`. Bordes, nocturnos, cambios de horario, seeds, script y stock cubiertos. |
| Pruebas de seguridad | ✔ Suites de seguridad de los servicios y del gateway incluidas en ambas pasadas; `npm run lint` y `node scripts/audit-policy.cjs` pasaron. |
| Checklist de cierre | ✘ En clon limpio `C:\Proyectos\fp-audit-ci-ld`, nueve workflows de servicios y gateway pasaron; `deploy-hello` falló en `prisma:generate`. Contenedores, recorrido local y LIM→MAD: evidencia del humano. |
| Conformidad con el contrato | ✔ Suites Ajv v1/v2 del gateway verdes; sin cambios en `contracts/` ni migraciones. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | LD-T7, checklist de cierre | `.github/workflows/deploy-service.yml:59`; `npm run prisma:generate -w platform/hello` en clon limpio | El workflow `deploy-hello`, activado por `packages/shared/**`, falla con `Missing script: "prisma:generate"` (rc=1). |
## Observaciones (no bloquean → BACKLOG)
