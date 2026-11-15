# Auditoría F12 — #35
- Fecha: 2026-11-14 · Commit auditado: 16034b10d8fbff29f039175f8a07051663b84402 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — `origin/main` contiene el squash F12c-3; GraphQL `Ready` al 100 % con imagen etiquetada con ese SHA, `/health` 200; web `/` y `/admin` 200. Despliegue y recorrido de rol admin solo de lectura registrados por el humano en `2026-11-14_dev_F12c-3_deploy_1.md`. |
| Pruebas de seguridad | ✔ — `CORS_ORIGINS` exacto; consulta libre e introspección 403; `AdminWebBookings` sin token `UNAUTHENTICATED` y sin datos; cabeceras CSP, X-Frame-Options, Referrer-Policy, HSTS y nosniff presentes en ambas rutas; HTML inicial sin fragmento admin; script inicial sin los indicadores sensibles exigidos; 286 registros de ejecución desde el despliegue sin errores, HTTP 5xx, variables, tokens ni PII detectada. |
| Checklist de cierre | ✔ — Panel admin publicado; acceso por rol y recorrido de solo lectura acreditados en la bitácora humana; health y cabeceras comprobados remotamente. |
| Conformidad con el contrato | ✔ — `AdminWebBookings` sin token no entrega datos; el código y el contrato quedaron aprobados en audit-34, sin cambios posteriores. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
Ninguna.
