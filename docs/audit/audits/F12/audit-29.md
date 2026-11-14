# Auditoría F12 — #29
- Fecha: 2026-11-13 · Commit auditado: 6a78ac96be989ce0d2378590bcaad400b4cc6cbb · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Despliegue: squash en `origin/main`; web publicada con `/`, `/estado` y ruta inexistente en 200; nueve revisiones Cloud Run Ready. Recorrido de navegador y Supabase registrados como evidencia humana en `2026-11-13_dev_F12c-2a_deploy_1.md`. |
| Pruebas de seguridad | ✔ CSP con `connect-src` solo GraphQL y Supabase; cabeceras exigidas presentes; paquete público sin patrones de secretos, acceso local ni recursos LATAM; CORS exacto para la web y ausente para origen ajeno; 67 registros GraphQL sin variables, tokens ni datos personales. |
| Checklist de cierre | ✔ Blueprint desde `render.yaml`, `autoDeploy: false`, URL pública activa; CORS y redirecciones Supabase según evidencia humana; `gcloud logging read` sin errores en los nueve servicios desde antes del despliegue. |
| Conformidad con el contrato | N/A — auditoría de despliegue; código aprobado en audit-28, sin nueva auditoría de suites ni cambios del contrato. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- La guía `docs/dev/f12c2a-web-despliegue.md` no advierte del incidente de `CORS_ORIGINS` con barra final ni del sufijo de URL asignado por Render; ambos constan en el BACKLOG del humano.
