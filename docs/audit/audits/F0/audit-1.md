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
| H3 | F0-SEC-04 | `curl "$SUPABASE_URL/rest/v1/nonexistent_probe?limit=1" -H "apikey: <publishable key>" -H "Accept-Profile: inventory"` (igual con pricing, ancillaries, reservation, ticketing, operations, webhooks, gateway) | Los 8 esquemas responden `PGRST205` (esquema aceptado); un esquema inexistente responde `PGRST106` con `hint: Only the following schemas are exposed: public, graphql_public, ancillaries, inventory, operations, pricing, gateway, reservation, ticketing, webhooks`. Los esquemas del servicio figuran en "Exposed schemas" de la Data API. |
| H2 | Checklist de cierre | `npm test` en clon limpio de bd592f7: `Tests: 1 failed, 11 passed` | Ítem "`npm run build`, `npm run lint` y `npm test` verdes en todos los workspaces" incumplido. |
| H4 | Checklist de cierre | Mismo comando de H3 | Ítem "Roles de base de datos aislados" depende de que los esquemas no estén expuestos; la bitácora dev 0 #6 (19:48) declara que solo `public` y `graphql_public` lo están, y el hint de la Data API lo contradice. |
## Observaciones (no bloquean → BACKLOG)
- F0-10: la prueba solo consta como verificación manual en la bitácora; no hay prueba automatizada que la repita (verificada por el auditor con un archivo temporal: falla el lint como se espera).
- F0-12: no verificable por el auditor (sin credenciales de base); la bitácora dev lo respalda con sus propias pruebas.
- `npm run gen:contracts` en el clon deja modificados los archivos generados versionados (`git status`).
- `infra/scripts/smoke-hello.cjs` usa credenciales no TLS; contra `:443` falla con `UNAVAILABLE`.
- La bitácora dev 0 #6 declara `npm test` 12/12 en el árbol del developer; en el clon limpio no se reproduce.
