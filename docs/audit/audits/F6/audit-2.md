# Auditoría F6 — #2
- Fecha: 2026-10-11 · Commit auditado: 54d369a · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | N/A |

Auditoría de despliegue (OPS-06, `flujo-cierre.md`); el código se aprobó en audit-1 y no se re-audita. Evidencia del humano (`docs/dev/progress/2026-10-11_dev_F6_deploy_1.md`): `migrate status` (esquema `operations` en `pooler.supabase.com`, "Database schema is up to date!"), `gcloud run services describe` (Ready, `operations-service-00001-lrk` con 100 % de tráfico, `INVENTORY_GRPC_URL`, `WEBHOOKS_GRPC_URL`, `GRPC_TLS=true`, `INTERNAL_API_KEY` y `DATABASE_URL` por Secret Manager), health con llave `SERVING`. Verificación propia: `grpcurl` `grpc.health.v1.Health/Check` contra `operations-service-gtl24uc77a-ue.a.run.app:443` sin llave ⇒ `Code: Unauthenticated`.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| 1 | OPS-06 | `docs/dev/progress/2026-10-11_dev_F6_deploy_1.md`, sección "Smoke OPS-06" (líneas 88-116) | El smoke contra Cloud Run terminó en error (`Error: INTERNAL_API_KEY, FLIGHT_NUMBER, FLIGHT_DATE and FLIGHT_INSTANCE_ID are required`, `smoke.cjs:12`); no hay ejecución exitosa registrada del estado de un vuelo del seed ni del retraso con `estimatedAt`. El checklist de cierre ("smoke en Cloud Run") no está cumplido. |

## Observaciones (no bloquean → BACKLOG)
- La bitácora del deploy declara "listo para auditoría (despliegue)" aunque el smoke registrado falló.
- Las observaciones de audit-1 siguen registradas en BACKLOG.md para F10; no se re-evalúan.
