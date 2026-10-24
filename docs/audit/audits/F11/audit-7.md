# Auditoría F11 — #7
- Fecha: 2026-10-24 · Commit auditado: fc30091 (bitácora de despliegue F11c-1, rama `feat/F11c1-scheduler`; código aprobado en audit-6) · Veredicto: RECHAZADO
- Alcance: auditoría de despliegue de la entrega F11c-1 (scheduler y recuperación) según `docs/audit/context/flujo-cierre.md`: siete microservicios en Cloud Run y gateway en Render (https://flight-gateway-o37n.onrender.com). Informe previo: audit-6 APROBADO (código). No se re-auditó el código ni se ejecutaron suites.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor (sin llave ni token):
- `gcloud run services describe <servicio> --region us-east1` para los siete ⇒ `Ready=True`, tráfico 100 % a la última revisión: inventory `00012-8gz`, pricing `00008-sbf`, ticketing `00012-qsg`, webhooks `00009-9vx`, operations `00006-9d2`, ancillaries `00007-5tx`, reservation `00010-xjv`.
- `grpcurl` (proto de `grpc-health-check` del checkout `flight-platform`) `grpc.health.v1.Health/Check` sin llave a los siete ⇒ `Code: Unauthenticated` en todos.
- `GET /flights/v1/health` en Render ⇒ 200 (a las 18:04Z, para despertar el gateway, y de nuevo a las ≈18:14Z).
- `GET /flights/v1/bookings` sin token ⇒ 401 `application/problem+json`; con token inventado ⇒ 401 `application/problem+json`.
- `gcloud logging read` de Cloud Run (filtro `httpRequest.requestUrl` por método, ventana de 10–15 min, sondeo cada 30 s durante ≈9 min desde las 18:04Z con el gateway despierto) para `ExpireHolds` (inventory), `ResumePending` (reservation), `DispatchPending` (webhooks) y `RecoverCheckIns` (operations) ⇒ 0 llamadas en los cuatro. Listado sin filtro de método desde las 18:04Z: solo aparecen mis `grpc.health.v1.Health/Check`; la última actividad previa es de las 17:57Z (smokes del humano, `grpc-node-js`).

Evidencia del humano revisada (`2026-10-24_dev_F11c1_deploy_1.md`, no re-ejecutada): migraciones de operations y gateway «up to date» sobre `pooler.supabase.com`; revisiones y describe coincidentes con los del auditor; health con llave `SERVING` y sin llave `Unauthenticated` en los siete; smokes gRPC (RSV-13, PST-08, ANC-11, Pricing, DCS-06) y REST contra Render (J1, J5, J6 sin admin) completos. Las secciones «Scheduler: llamadas a las tareas en Cloud Run» y «Scheduler: conteo por tarea y resultado» de esa bitácora están vacías.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| 1 | PLT-H2 (activar scheduler; `ExpireHolds`, `ResumePending`, `DispatchPending` cada minuto, más `RecoverCheckIns`) | `gcloud logging read` Cloud Run de inventory, reservation, webhooks y operations, 18:04Z–18:13Z con el gateway respondiendo 200; y `2026-10-24_dev_F11c1_deploy_1.md`, secciones del scheduler vacías | Ninguna de las cuatro llamadas periódicas aparece en los logs de Cloud Run (0 de 4 tareas, ≈9 min con el gateway despierto, intervalo configurado de 60 s); la bitácora tampoco aporta conteos. El scheduler activo en producción no queda demostrado. |
## Observaciones (no bloquean → BACKLOG)
- O1 (despliegue): `origin/main` está en `4222e7c` y no contiene `40534ec`, el commit que la bitácora declara como «Commit en main»; los commits de F11c-1 solo están en `origin/feat/F11c1-scheduler`.
- O2 (despliegue): los smokes REST con token real de customer solo se evidencian en la bitácora del humano; el auditor no los reprodujo (sin tokens reales, por instrucción). J2 a J4 quedan cubiertos por las suites locales de audit-6.
