# Auditoría F11 — #8
- Fecha: 2026-10-24 · Commit auditado: c4601a2 (bitácora de despliegue #2 de F11c-1 sobre `origin/main`; código `6581708` aprobado en audit-6) · Veredicto: APROBADO
- Alcance: auditoría de despliegue #2 de la entrega F11c-1 (scheduler y recuperación) según `docs/audit/context/flujo-cierre.md`: siete microservicios en Cloud Run y gateway en Render (https://flight-gateway-o37n.onrender.com). Informe previo: audit-7 RECHAZADO (H1: sin llamadas del scheduler). No se re-auditó el código ni se ejecutaron suites.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

H1 de audit-7 (PLT-H2, scheduler sin llamadas en Cloud Run): resuelto.

Comandos ejecutados por el auditor (sin llave ni token):
- `git`: `origin/main` = `c4601a2`; `6581708` (squash de F11c-1) está contenido en `origin/main` y solo `origin/main`/`origin/HEAD` lo contienen; `docs/dev/progress/2026-10-24_dev_F11c1_deploy_1.md` no existe en `origin/main` (solo las `*_deploy_1` de fases anteriores).
- `gcloud run services describe <servicio> --region us-east1` para los siete ⇒ `Ready=True`, 100 % del tráfico a la última revisión: inventory `00013-6hb`, pricing `00009-bsn`, ticketing `00013-rbf`, webhooks `00010-fn5`, operations `00007-wnw`, ancillaries `00008-td7`, reservation `00011-9g7` (coinciden con la bitácora del humano).
- `grpcurl` (proto de `grpc-health-check` del checkout `flight-platform`) `grpc.health.v1.Health/Check` sin llave a los siete ⇒ `Code: Unauthenticated` en todos.
- `GET /flights/v1/health` en Render ⇒ 200 (≈01:58Z, para despertar el gateway; de nuevo ≈02:08Z).
- Espera de ≈3 min tras el despertar. `gcloud logging read` de Cloud Run (`httpRequest.requestUrl` por método), ventana 01:57Z–02:04Z ⇒ 32 llamadas: 8 rondas, una por minuto, de cada una de `inventory.InventoryService/ExpireHolds`, `reservation.ReservationService/ResumePending`, `webhooks.WebhooksService/DispatchPending` y `operations.OperationsService/RecoverCheckIns`; la ronda de 02:04:18Z con status 200 en las cuatro. Entradas con `correlationId: gateway-scheduler`.
- `GET /flights/v1/bookings` sin token ⇒ 401 `application/problem+json; charset=utf-8`; con token inventado ⇒ 401 `application/problem+json; charset=utf-8`.

Evidencia del humano (`2026-10-24_dev_F11c1_deploy_2.md`, no re-ejecutada): commit desplegado `6581708`; migraciones de operations (4) y gateway (2) «up to date» sobre `pooler.supabase.com`; describe de operations, inventory, webhooks y reservation con las `*_GRPC_URL`, `GRPC_TLS` y secretos esperados; health con llave `SERVING` y sin llave `Unauthenticated` en los siete; 12 llamadas del scheduler en los logs; smokes gRPC (RSV-13, PST-08, ANC-11, Pricing, DCS-06) y REST contra Render (J1, J5, J6 sin admin; reservas con token de customer 200) completos. J2 a J4 no se ejecutan contra Render (controles de prueba solo locales); quedan cubiertos por las suites locales aprobadas en audit-6.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- O1 (despliegue): los smokes REST con token real de customer solo se evidencian en la bitácora del humano; el auditor no los reprodujo (sin tokens reales, por instrucción).
