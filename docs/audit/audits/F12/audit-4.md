# Auditoría F12 — #4
- Fecha: 2026-10-31 · Commit auditado: 48b272e (main; código desplegado 13181a3) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ (aprobadas en audit-1 a audit-3; no se reejecutan en esta auditoría de despliegue) |
| Pruebas de seguridad | ✔ (401 sin credenciales en v1 y v2; health gRPC sin llave ⇒ Unauthenticated en los siete) |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle (verificación propia, sin llave ni token; auditoría de despliegue según `flujo-cierre.md`):

| Verificación | Comando / lugar | Resultado |
|---|---|---|
| origin/main contiene el squash de F12a | `git log` en main; `git branch --contains 13181a3` en origin (`C:\Proyectos\flight-platform`) | `13181a3` y `48b272e` en main |
| Cloud Run, siete servicios | `gcloud run services describe <svc> --region us-east1` | Ready=True y 100 % del tráfico a la última revisión en todos: inventory 00016-bxd, pricing 00012-wcr, ticketing 00017-dmt, webhooks 00013-pld, operations 00010-dfv, ancillaries 00011-lf5, reservation 00014-bx5 |
| Variables prohibidas | `env` de cada servicio | ninguno tiene `INTEGRATION_LOCAL` ni `BOOKING_PAYMENTS_VERIFY` |
| Health gRPC sin llave | `grpcurl … grpc.health.v1.Health/Check` contra `<svc>-gtl24uc77a-ue.a.run.app:443` | los siete: `Code: Unauthenticated` |
| Render v1 health | `GET /flights/v1/health` | 200 `{"status":"ok"}` |
| Render v2 health | `GET /api/v2/vuelos/health` | 200, `nodo_id` = `NODE_VUE_GABATAIR`, siete dependencias UP |
| JWKS | `GET /api/v2/.well-known/jwks.json` | 200, 1 llave con campos `kty,n,e,kid,alg,use`; sin `d,p,q,dp,dq,qi` |
| Búsqueda pública v2 | `POST /api/v2/vuelos/search` (UIO-GYE ida y vuelta, 2026-11-20/25, `X-Device-Fingerprint`) | 200, `totalOffers: 4`, 4 ofertas con 2 itinerarios; sin cabecera ⇒ 400 `application/problem+json` |
| 401 problem+json | `GET /flights/v1/bookings`; `POST /api/v2/vuelos/bookings` (sin token, cuerpo inválido); `POST /api/v2/vuelos/booking-events` | los tres: 401 `application/problem+json` (v1 `VALIDATION_FAILED` según PLAN §1.4; v2 `UNAUTHORIZED`) |
| Scheduler | health de Render a las 11:49 y consulta de logs a las 11:52 (`jsonPayload.correlationId=gateway-scheduler`) | `expireHolds` (inventory), `resumePending` (reservation), `dispatchPending` (webhooks) y `recoverCheckIns` (operations): 7 llamadas `rpc ok` cada una en 8 min, la última 16:51:45Z |

Evidencia del humano (registrada, no reejecutada; `docs/dev/progress/2026-10-31_dev_F12a_deploy_1.md`): ocho migraciones en Supabase con Datasource en `pooler.supabase.com`, revisiones y health con llave de los siete, v2 con el cliente temporal `gabatair-verif` (desactivado después), regresión v1 con tokens reales (J1, J5, J6, administración, webhooks).

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
1. Bitácora del humano, sección «v2 hold con el cliente de verificación»: `holdId obtenido: False · estado:` (vacío), mientras el registro dice «hold y liberación». No verificable sin token y sin ítem de cierre definido para F12a; el hold v2 en la nube queda sin evidencia positiva.
2. En la misma bitácora, las secciones «Merge» y «Deploy» remiten a «Ver commit abajo» / «Ver revisiones» sin que el SHA aparezca en el registro (sí en la evidencia).
3. `instance` de los ProblemDetails de v2 en 401/400 de `/vuelos/bookings` y `/vuelos/search` es `/vuelos/...` y no la ruta pública completa `/api/v2/vuelos/...` (en `booking-events` sí es completa).
