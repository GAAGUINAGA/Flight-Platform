# Auditoría F5 — #3
- Fecha: 2026-10-11 · Commit auditado: 8238375 (main; código aprobado en audit-2) · Veredicto: APROBADO
- Alcance: auditoría de despliegue (PRC-13 y PRC-14). No se re-audita el código ni se ejecutan suites.

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (PRC-13 migración + seed + deploy; PRC-14 smoke: búsqueda simple y multidestino → hold → consulta → liberación) | ✔ |
| Pruebas de seguridad (health sin llave contra Cloud Run) | ✔ |
| Checklist de cierre (smoke contra Cloud Run; revisión Ready con 100 % del tráfico; configuración y secretos) | ✔ |
| Conformidad con el contrato | N/A (sin cambios de código; validado en audit-2) |

### Verificado por el auditor
- Health sin llave: cliente gRPC por TLS contra `pricing-service-gtl24uc77a-ue.a.run.app:443` ⇒ `code=16 UNAUTHENTICATED`.

### Evidencia del humano
- `gcloud run services describe pricing-service --region us-east1` (salida filtrada, `C:\Proyectos\pricing-describe.txt`; el auditor no pudo ejecutar gcloud por permisos): condiciones `Ready`, `ConfigurationsReady` y `RoutesReady` en `True`; `latestReadyRevisionName: pricing-service-00001-7c2` con `percent: 100`; `INVENTORY_GRPC_URL=inventory-service-gtl24uc77a-ue.a.run.app:443` y `GRPC_TLS=true` como valores; `INTERNAL_API_KEY` y `DATABASE_URL` vía `secretKeyRef` (`internal-api-key`, `pricing-database-url`); cuenta de servicio `pricing-service-runtime@…`.
- Bitácora `docs/dev/progress/2026-10-11_dev_F5_deploy_1.md`: `prisma migrate status` ⇒ «Database schema is up to date!» (1 migración, esquema `pricing`); `pricing.fares` con 2484 filas; health con llave `SERVING`; smoke `scripts/smoke.cjs` con SearchOffers simple, multidestino, HoldOffer, GetOfferHold y ReleaseOfferHold OK, y rechazo sin llave `code 16`.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | — |

## Observaciones (no bloquean → BACKLOG)
- La revisión, el conteo de `pricing.fares`, `migrate status` y el smoke completo se apoyan en evidencia del humano; el auditor reprodujo solo el health sin llave.
