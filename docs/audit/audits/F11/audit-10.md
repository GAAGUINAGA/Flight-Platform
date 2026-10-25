# Auditoría F11 — #10
- Fecha: 2026-10-25 · Commit auditado: 252c8ff (bitácora de despliegue de F11c-2 sobre `origin/main`; código `bfc0f45` aprobado en audit-9) · Veredicto: APROBADO
- Alcance: auditoría de despliegue de la entrega F11c-2 (webhooks y administración por REST) según `docs/audit/context/flujo-cierre.md`: pricing, webhooks, reservation y operations en Cloud Run, y gateway en Render (https://flight-gateway-o37n.onrender.com). No se re-auditó el código ni se ejecutaron suites.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor (sin llave ni token):
- `git`: `origin/main` = `252c8ff`; `bfc0f45` (squash de F11c-2) está contenido en `origin/main` (`git branch -r --contains bfc0f45` ⇒ `origin/main`, `origin/HEAD`).
- `gcloud run services describe <servicio> --region us-east1` ⇒ `Ready=True` y 100 % del tráfico a la última revisión: pricing `00010-bmp`, webhooks `00011-bm2`, reservation `00012-pjj`, operations `00008-cqh` (coinciden con la bitácora del humano).
- `grpcurl` (proto de `grpc-health-check` del checkout `flight-platform`) `grpc.health.v1.Health/Check` sin llave a los cuatro ⇒ `Code: Unauthenticated`.
- `GET /flights/v1/health` en Render ⇒ 200 (≈05:12:57Z).
- `GET /flights/v1/admin/flights` y `GET /flights/v1/bookings`, sin token y con token inventado ⇒ 401 `application/problem+json; charset=utf-8` en las cuatro combinaciones.
- Scheduler: tras el health de las 05:12:57Z y una espera de ≈3 min, `gcloud logging read` (`httpRequest.requestUrl`) ⇒ rondas de 05:13:06Z, 05:14:06Z y 05:15:06Z, cada una con `ExpireHolds`, `ResumePending`, `DispatchPending` y `RecoverCheckIns`, status 200 en las 12 llamadas; también rondas por minuto desde 05:07Z.

Evidencia del humano (`2026-10-25_dev_F11c2_deploy_1.md`, no re-ejecutada): commit desplegado `bfc0f45`; revisiones Ready de los siete; describe de los cuatro redesplegados con las variables y secretos esperados; health con llave `SERVING` y sin llave `Unauthenticated` en los siete; regresión del scheduler (44 llamadas); PLT-SEC-01 con tokens reales de Supabase (`/admin`: 401 sin token, 403 customer, 200 admin; reservas con customer 200); smokes de regresión por gRPC (Pricing, RSV-13, PST-08, DCS-06) y REST (J1, J5, J6); smoke de administración y webhooks de F11c-2 completo.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- O1 (despliegue): los smokes con tokens reales (PLT-SEC-01, REST con customer/admin) y el smoke de administración y webhooks solo se evidencian en la bitácora del humano; el auditor no los reprodujo (sin tokens reales, por instrucción).
