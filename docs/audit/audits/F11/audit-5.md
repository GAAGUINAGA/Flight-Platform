# Auditoría F11 — #5
- Fecha: 2026-10-23 · Commit auditado: a9cac0a (código desplegado: 36bde88) · Veredicto: APROBADO
- Alcance: auditoría de despliegue de la entrega F11b (postventa y check-in por REST) según `docs/audit/context/flujo-cierre.md`: reservation-service en Cloud Run (revisión `reservation-service-00010-xjv`) y gateway en Render (https://flight-gateway-o37n.onrender.com). Informe previo: audit-4 APROBADO (código). No se re-auditó el código ni se ejecutaron suites.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor (sin llave ni token):
- `gcloud run services describe reservation-service --region us-east1` ⇒ `Ready=True`, `ConfigurationsReady=True`, `RoutesReady=True`; `latestReadyRevisionName: reservation-service-00010-xjv`; tráfico `latestRevision: true`, `percent: 100`.
- `grpcurl` (proto de `grpc-health-check` del checkout `flight-platform`) `grpc.health.v1.Health/Check` a `reservation-service-gtl24uc77a-ue.a.run.app:443` sin llave ⇒ `Code: Unauthenticated`, `Message: UNAUTHENTICATED`, exit 80.
- `GET /flights/v1/health` en Render ⇒ `200 OK`, `application/json`, `{"status":"ok"}`.
- `GET /flights/v1/bookings` sin `Authorization` ⇒ `401`, `Content-Type: application/problem+json`, `code: VALIDATION_FAILED`, `detail: "Authentication required"`.
- `GET /flights/v1/bookings` con `Authorization: Bearer tokeninventado.abc.def` ⇒ `401`, `application/problem+json`, cuerpo idéntico al anterior (no distingue el motivo del rechazo).
- Ninguna respuesta incluye traza, clases, rutas ni mensajes internos; `code` coincide con PLAN §1.4 y el enum del OpenAPI.

Evidencia del humano revisada (`2026-10-23_dev_F11b_deploy_1.md`, no re-ejecutada): migración remota «Database schema is up to date» sobre `pooler.supabase.com`; describe coincidente con el obtenido por el auditor (misma revisión, 100 %); health con llave `SERVING` y sin llave `Unauthenticated`; regresión gRPC de reservation (RSV-13 y PST-08) completa; gateway 200/401/401/200; smokes REST J1, J5 y J6 (sin admin) completos contra Render. Variables de Render (`OPERATIONS_GRPC_URL`) declaradas por el humano. Solo se redesplegaron reservation-service y el gateway.

Evaluación de la primera ejecución del smoke de J5/J6 (check-in con 503 `RATE_LIMIT_EXCEEDED` por arranque en frío de operations; segunda ejecución inmediata pasó los 15 pasos): ocurrió con servicios de Cloud Run en frío y se registra como evidencia del humano. El plan no fija presupuesto de latencia ni exige tolerancia al arranque en frío para esta entrega, el error devuelto es un ProblemDetails con código del enum y sin detalles internos, y es el mismo caso aceptado en audit-2. Por PLAN §4.4 no es causa de rechazo; se registra como observación.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | Ninguno |
## Observaciones (no bloquean → BACKLOG)
- O1 (despliegue): el check-in de J6 devolvió 503 `RATE_LIMIT_EXCEEDED` en la primera ejecución con operations en frío; la segunda pasó. Recurrencia del problema de arranques en frío ya registrado en BACKLOG.md.
- O2 (despliegue): el token de customer real y los smokes REST solo se evidencian en la bitácora del humano; el auditor no los reprodujo (sin tokens reales, por instrucción).
- O3 (despliegue): la parte de J6 con admin (retraso y cancelación del vuelo) y la prueba S contra `/admin` quedan para F11c, ya declarado.
