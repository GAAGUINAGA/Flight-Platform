# Auditoría F0 — #2
- Fecha: 2026-10-06 · Commit auditado: 9db9382 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | N/A |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- Hallazgos de audit-1 resueltos: H1/H2 (clon limpio de 9db9382: `npm test` 13/13, `platform/hello` 3/3 ejecuciones; lint, build, `gen:contracts` y `npm audit --audit-level=high` con exit 0); H3/H4 (Data API: los 8 esquemas de servicio responden `PGRST106`, solo `public` y `graphql_public` expuestos).
- Auditoría sobre 9db9382 a petición del humano: la bitácora dev 0 #7 quedó en `en curso` por falta de créditos del developer.
- Cloud Run: `hello-service` sigue en la revisión `00001-nkt` (imagen de bd592f7); responde `SERVING` con llave y `UNAUTHENTICATED` sin ella. El código corregido no está desplegado.
- F0-10: la prueba sigue siendo manual (verificada por el auditor: el lint falla con un import de `@nestjs/common` en `domain/`).
- F0-12: no verificable por el auditor (sin credenciales de base).
- `infra/scripts/smoke-hello.cjs` usa credenciales no TLS; contra `:443` falla con `UNAVAILABLE`.
- `npm run gen:contracts` en un clon limpio deja modificados los archivos generados versionados.
