# Auditoría F12 — #32
- Fecha: 2026-11-14 · Commit auditado: 929da35ced8f7b5f22a0aac5b8f54b59738aef33 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — audit-31 aprobó el código; la bitácora humana registra compra completa, reservas, check-in y cancelación en la web publicada. |
| Pruebas de seguridad | ✔ — GraphQL: `/health` 200, consulta libre e introspección 403, origen ajeno sin CORS; 112 registros de aplicación desde el despliegue sin errores ni coincidencias de datos sensibles. |
| Checklist de cierre | ✘ — `origin/main` contiene el squash; GraphQL Ready con imagen de `929da35` y CORS exacto; `/` y `/reservas` 200 con cabeceras exigidas; el script publicado conserva la banda de pruebas. |
| Conformidad con el contrato | N/A — auditoría limitada al despliegue; el código fue aprobado en audit-31. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-2b despliegue web | `GET https://flight-web-238b.onrender.com/assets/index-Be6ED90O.js` → 200; búsqueda de `Entorno de pruebas` → presente | El script publicado contiene la banda de pruebas, contra la comprobación de despliegue solicitada. |
## Observaciones (no bloquean → BACKLOG)
Ninguna nueva.
