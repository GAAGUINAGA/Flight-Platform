# Auditoría F12 — #39
- Fecha: 2026-11-15 · Commit auditado: 42debcbc5b98cd51887f7e98d33c0659b090c5cd · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ — Las pruebas ejecutadas pasan: Gateway CI 344/344, GraphQL 131/131, web 313/313, compartidos 97/97, registro real 6/6 y gateway real 648/648 dos veces; H1 deja un camino sin registro. |
| Pruebas de seguridad | ✘ — Roles, lista blanca y códigos cerrados pasan; H2 incumple el orden de autorización y lectura. |
| Checklist de cierre | ✘ — Lint, builds limpios, codegen, audit-policy y npm audit pasan; el registro de todo intento sigue incompleto. Imágenes verificadas por el humano. |
| Conformidad con el contrato | ✘ — El OpenAPI público no cambió; H3 afecta la documentación de la ruta interna. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-4a, registrar todo intento de búsqueda | `platform/api-gateway/src/app.ts:114` | `POST /api/admin/v1/bookings/search` con `X-Forwarded-Proto: http` responde 400 antes de `searchBooking`, sin insertar ninguna fila. |
| H2 | F12c-4a, autorizar antes de leer el cuerpo | `platform/api-gateway/src/app.ts:121` | `searchBodyReader` lee el cuerpo antes de que `mountAdminApiHttp` autentique y compruebe el rol en la línea 124. |
| H3 | F12c-4a, contrato interno de búsqueda | `contracts/openapi/interno/admin-v1.yaml:133` | La ruta aún declara 400 para la solicitud inválida, aunque los cuerpos inválidos se registran y responden 404 `NOT_FOUND`. |
## Observaciones (no bloquean → BACKLOG)
Ninguna.
