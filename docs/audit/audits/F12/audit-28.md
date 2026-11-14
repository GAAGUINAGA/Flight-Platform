# Auditoría F12 — #28
- Fecha: 2026-11-13 · Commit auditado: fbff71d · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ CI web en clon limpio: 92 pruebas de paquetes y acceso local, 89 de web; codegen y builds correctos. CI gateway, inventory y reservation: 305, 28 y 226 pruebas. Suite real completa del gateway con ESB, dos corridas: 21 suites y 648 pruebas aprobadas en cada una. |
| Pruebas de seguridad | ✔ Acceso local excluido del paquete y rechazado con `NODE_ENV=production`; bundle sin secretos ni emisor local; CSP restringida a GraphQL y Supabase; pruebas de seguridad, accesibilidad y fronteras de paquetes aprobadas. |
| Checklist de cierre | ✔ Lint, política de dependencias, builds en clon limpio y Render Static configurados; evidencia humana de imágenes, Playwright y paquete con valores de producción registrada en la bitácora developer. |
| Conformidad con el contrato | ✔ OpenAPI sin cambios; operaciones GraphQL conocidas y tipos generados al día; suite real del gateway valida respuestas contra el contrato. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- `npm run codegen:check` no existe en la raíz; `npm run codegen:check -w @flight-platform/graphql-schema`, usado por CI, pasa.
