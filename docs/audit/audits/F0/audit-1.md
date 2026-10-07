# Auditoría F0 — #1
- Fecha: 2026-10-06 · Commit auditado: bd592f7 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✘ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | N/A |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F0-15 / F0-SEC-01 | `npm test` en clon limpio (`npm ci` + `npm run build`), `platform/hello/src/main.spec.ts:19` | La prueba falla de forma determinista (3/3 y desde PowerShell): sin llave se esperaba `UNAUTHENTICATED` (16) y se recibe `INTERNAL` (13); `instanceof RpcException` es `false` bajo Jest para el error lanzado por `buildRequestContext`. Resultado: 11/12. |
| H2 | Checklist de cierre | `npm test` en clon limpio de bd592f7: `Tests: 1 failed, 11 passed` | Ítem "`npm run build`, `npm run lint` y `npm test` verdes en todos los workspaces" incumplido. |
## Observaciones (no bloquean → BACKLOG)
- F0-10: la prueba solo consta como verificación manual en la bitácora; no hay prueba automatizada que la repita (verificada por el auditor con un archivo temporal: falla el lint como se espera).
- F0-12 y la parte Data API de F0-SEC-04: no verificables por el auditor; la bitácora dev las respalda con declaración humana.
- `npm run gen:contracts` en el clon deja modificados los archivos generados versionados (`git status`).
- `infra/scripts/smoke-hello.cjs` usa credenciales no TLS; contra `:443` falla con `UNAVAILABLE`.
- La bitácora dev 0 #6 declara `npm test` 12/12 en el árbol del developer; en el clon limpio no se reproduce.
