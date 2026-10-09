# Auditoría F3 — #3
- Fecha: 2026-10-09 · Commit auditado: f40b0aa · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (WHK-07: smoke con evento recibido y firma, evidencia del humano en `2026-10-07_dev_F3_deploy_1.md`; no se ejecutaron suites por alcance) | ✔ |
| Pruebas de seguridad (llamada de health sin llave contra Cloud Run: `grpcurl ... grpc.health.v1.Health/Check` ⇒ `Code: Unauthenticated`, `Message: UNAUTHENTICATED`) | ✔ |
| Checklist de cierre (servicio en Cloud Run, llamada sin llave rechazada, migración remota, smoke y entrega firmada) | ✔ |
| Conformidad con el contrato | N/A |
## Evidencia del humano (registrada, no re-ejecutada)
- Migración remota: `prisma migrate status` contra Supabase, esquema `webhooks`, 1 migración, esquema actualizado.
- Health con llave `SERVING`; sin llave `Unauthenticated`.
- Smoke en `webhooks-service-gtl24uc77a-ue.a.run.app:443`: `OK CreateSubscription`, `OK PublishEvent ad269d19-…`, `OK DispatchPending`.
- Recepción en webhook.site: `POST` con `x-flight-signature: t=1791402555,v1=f00bda44…` y payload `booking.confirmed` del evento `ad269d19-…`.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | Sin hallazgos. |
## Observaciones (no bloquean → BACKLOG)
- `gcloud run services describe webhooks-service --region us-east1` fue denegado por el entorno; revisión Ready y tráfico al 100 % no verificados por el auditor. El servicio responde en la URL pública (rechazo sin llave observado por el auditor).
- La firma del receptor no fue recalculada por el auditor: el secreto no se lee; se acepta la evidencia del humano.
