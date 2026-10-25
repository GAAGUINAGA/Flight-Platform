# Auditoría F11 — #13
- Fecha: 2026-10-25 · Commit auditado: a68b021 (bitácora de despliegue de F11d-1 sobre `origin/main`; código `d91f3b4` aprobado en audit-12) · Veredicto: APROBADO
- Alcance: auditoría de despliegue de la entrega F11d-1 (migración a Zod 4) según `docs/audit/context/flujo-cierre.md`: siete microservicios en Cloud Run y gateway en Render (https://flight-gateway-o37n.onrender.com). No se re-auditó el código ni se ejecutaron suites.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor (sin llave ni token):
- `git`: `origin/main` = `a68b021`; `d91f3b4` (squash de F11d-1) está contenido en `origin/main` (`git branch -r --contains d91f3b4` ⇒ `origin/main`, `origin/HEAD`).
- `gcloud run services describe <servicio> --region us-east1`: `Ready=True` y 100 % del tráfico a la última revisión en los siete: inventory `00015-jjw`, pricing `00011-mvl`, ticketing `00015-hl2`, webhooks `00012-scd`, operations `00009-vmp`, ancillaries `00010-jnj`, reservation `00013-8l6` (coinciden con la bitácora del humano).
- `grpcurl` (proto de `grpc-health-check` del checkout `flight-platform`) `grpc.health.v1.Health/Check` sin llave a los siete ⇒ `Code: Unauthenticated`.
- `GET /flights/v1/health` en Render ⇒ 200 (≈15:45:30Z).
- `GET /flights/v1/bookings` y `GET /flights/v1/admin/flights`, sin token y con token inventado ⇒ 401 `application/problem+json; charset=utf-8` en las cuatro combinaciones.
- Scheduler: tras el health y una espera de ≈3 min, `gcloud logging read` (`httpRequest.requestUrl`) ⇒ rondas de 15:46:27Z, 15:47:26Z y 15:48:26Z, cada una con `ExpireHolds`, `ResumePending`, `DispatchPending` y `RecoverCheckIns`, status 200 (12 llamadas; también la ronda de 15:45:27Z).
- `node scripts/audit-policy.cjs` ⇒ código 0, «npm audit policy passed: no high or critical vulnerabilities»; el script no contiene lista de excepciones.

Evidencia del humano (`2026-10-25_dev_F11d1_deploy_1.md`, no re-ejecutada): commit desplegado `d91f3b4`; ocho workflows de CI en verde; audit sin excepciones; health con llave `SERVING` en los siete; smokes por gRPC (Pricing, ANC-11, RSV-13, PST-08, DCS-06) y por REST con tokens reales de Supabase (J1, J5, J6, administración y webhooks); `/admin` con customer (403) y admin (200).
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- O1 (despliegue): los smokes con tokens reales y los gRPC con llave solo se evidencian en la bitácora del humano; el auditor no los reprodujo (sin llave ni tokens, por instrucción).
