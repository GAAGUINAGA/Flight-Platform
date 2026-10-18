# Auditoría F10 — #2
- Fecha: 2026-10-18 · Commit auditado: c74f77b (main; código 36b3269) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | N/A (auditoría de despliegue; código aprobado en audit-1) |
| Pruebas de seguridad | ✔ (health sin llave ⇒ Unauthenticated en los siete) |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | N/A |

Alcance: solo DCS-06 (despliegue) según `docs/audit/context/flujo-cierre.md`. No se ejecutaron suites ni se leyó ningún `.env`/secreto.

Verificado por el auditor (sin llave interna; `gcloud run services describe` en us-east1 y `grpcurl` con `-import-path` al proto de `grpc-health-check` del checkout `C:\Proyectos\flight-platform`, contra `*-service-gtl24uc77a-ue.a.run.app:443`):
- Última revisión creada = última Ready y 100 % del tráfico: ancillaries `00006-wrk`, inventory `00011-s98`, operations `00005-8dh`, pricing `00007-dn6`, reservation `00009-624`, ticketing `00011-l58`, webhooks `00008-7wj`. Coinciden con la tabla de revisiones de la evidencia del humano.
- `grpc.health.v1.Health/Check` sin llave: `Code: Unauthenticated` (exit 80) en los siete.

Evidencia del humano (registrada, no re-ejecutada; `2026-10-18_dev_F10_deploy_1.md`):
- `migrate status` de operations contra `aws-0-us-east-1.pooler.supabase.com`: 3 migraciones, "Database schema is up to date!".
- Describe de operations y ancillaries: Ready, 100 % a la última revisión, `INTERNAL_API_KEY` y `DATABASE_URL` desde Secret Manager, `GRPC_TLS=true`, URLs gRPC de operations configuradas.
- Health con llave SERVING y sin llave Unauthenticated en los siete.
- Smokes en Cloud Run: check-in (8 OK: oferta, hold, reserva, CheckIn, ListBoardingPasses, idempotencia, reserva ajena, sin llave), ancillaries (6 OK), regresión reservation RSV-13 (6 OK) y postventa PST-08 (10 OK).

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
1. La evidencia de describe incluye solo operations y ancillaries (los redesplegados); el estado de los otros cinco se apoya en la tabla de revisiones y en esta verificación.
2. El smoke de check-in registrado no muestra el vuelo del seed ni la ventana usada; solo las líneas OK.
