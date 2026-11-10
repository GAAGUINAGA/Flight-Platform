# Auditoría F12 — #16
- Fecha: 2026-11-09 · Commit auditado: c9670e351d858d330316eab120815184a6422f62 · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Código aprobado en audit-15; `origin/main` contiene el squash F12b-2. Evidencia del humano en `docs/dev/progress/2026-11-09_dev_F12b2_deploy_1.md`: CloudAMQP, esquema y migración ESB en Supabase, y evento real publicado e ingerido en 46 s. |
| Pruebas de seguridad | ✔ Sin llave: `GET /health/deps` y `POST /internal/v1/operations/sistema.publicar-eventos` dieron 401. Logs de los ocho servicios desde antes del despliegue: sin avisos prohibidos ni patrones de URL del broker, cadenas de conexión, tokens o datos personales. |
| Checklist de cierre | ✔ `gcloud run services describe` en us-east1: ocho servicios Ready y 100 % del tráfico en sus revisiones; secretos del ESB y RabbitMQ de Webhooks referenciados desde Secret Manager; `ESB_URL` en los tres emisores; sin `ESB_EVENTS_MODE=grpc`, `INTEGRATION_LOCAL` ni `BOOKING_PAYMENTS_VERIFY`. ESB `/health` 200; Render `/flights/v1/health` y `/api/v2/vuelos/health` 200. Tras despertar el gateway, logs recientes del ESB con `sistema.publicar-eventos` y `sistema.despachar-webhooks`, y de Webhooks con `dispatchPending`. |
| Conformidad con el contrato | N/A — auditoría exclusiva de despliegue; código aprobado en audit-15. |

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
Ninguna.
