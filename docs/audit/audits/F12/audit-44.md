# Auditoría F12 — #44
- Fecha: 2026-11-17 · Commit auditado: 47a7425e470185733bd9383a3672945fed2dca63 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — clon limpio: `npm ci`; Gateway 26 suites, 404/404; build Gateway correcto; `207055b` y `6bac765` tienen el mismo árbol. |
| Pruebas de seguridad | ✔ — suite Gateway verde; hotfix: entrada inválida, hold oculto 410 sin Pricing; búsqueda pública sin BUSINESS; sin coincidencias de PII o secretos en los campos de logs consultados. |
| Checklist de cierre | ✘ — nueve revisiones Cloud Run Ready y 100 %, health Gateway y web 200, cabeceras presentes; ocho respuestas 5xx del ESB después del hotfix. |
| Conformidad con el contrato | ✔ — búsqueda v2 200 con `totalOffers=2` y dos ofertas ECONOMY; código `OFFER_NO_LONGER_AVAILABLE` y estado 410 en la prueba del hold. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-4 / despliegue | `gcloud logging read 'resource.type="cloud_run_revision" AND timestamp>="2026-11-16T11:30:00Z" AND severity>=ERROR'`: ESB `2026-11-16T16:42:41Z`–`2026-11-17T16:08:43Z`, 7 HTTP 503 y 1 HTTP 504 | Hay ocho errores nuevos en rutas de eventos, check-ins, holds, reservas y búsqueda de ofertas, fuera del incidente BUSINESS descrito. |
## Observaciones (no bloquean → BACKLOG)
Ninguna.
