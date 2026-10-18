# Auditoría F9 — #6
- Fecha: 2026-10-17 · Commit auditado: 4b02130 (origin/main) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | N/A (auditoría de despliegue; código aprobado en audit-2, audit-3 y audit-5) |
| Pruebas de seguridad | ✔ (health sin llave ⇒ Unauthenticated en los siete) |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | N/A |

Alcance: solo PST-08 (despliegue) según `docs/audit/context/flujo-cierre.md`. No se ejecutaron suites ni se leyó ningún `.env`/secreto.

Verificado por el auditor (sin llave interna, `gcloud run services describe` y `grpcurl` contra `*-service-58066093285.us-east1.run.app:443`):
- Revisión Ready, última creada = última Ready, 100 % del tráfico, condición Ready=True: ancillaries `00005-pzs`, inventory `00010-t9w`, operations `00004-tfm`, pricing `00006-895`, reservation `00008-zhd`, ticketing `00010-lvl`, webhooks `00007-nrt`. Coinciden con las revisiones de la evidencia del humano.
- `grpc.health.v1.Health/Check` sin llave: `Code: Unauthenticated` en los siete.

Evidencia del humano (registrada, no re-ejecutada; `2026-10-17_dev_F9_deploy_1.md` y `2026-10-17_dev_F9_5.md`):
- `migrate status` de ancillaries y reservation contra `aws-0-us-east-1.pooler.supabase.com`: "Database schema is up to date!" (4 migraciones cada uno).
- Describe de ancillaries y reservation: Ready, 100 % a la última revisión, `INTERNAL_API_KEY` y `DATABASE_URL` desde Secret Manager, `GRPC_TLS=true`.
- Health con llave SERVING y sin llave Unauthenticated en los siete.
- Smokes en Cloud Run: reservation (6 OK), postventa PST-08 (10/10 OK: equipaje, cambio de fecha y cancelación), ancillaries (6 OK) y pricing (6 OK).
- Redespliegues: merge (siete servicios), corrección 1 (ancillaries y reservation), corrección 2 (reservation).

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
1. La bitácora `2026-10-17_dev_F9_5.md` conserva el marcador `<VARIABLE_NUEVA>` en lugar del nombre `RUN_PST_SMOKE_REAL`.
2. La bitácora `2026-10-17_dev_F9_5.md` cita en su cierre "28/28" para la carpeta de integración, mientras los registros de la sesión dan 18/18.
3. La evidencia de describe incluye solo ancillaries y reservation (los redesplegados tras el primer despliegue); el estado de los otros cinco se apoya en la tabla de revisiones y en esta verificación.
4. Las bitácoras de despliegue estaban sin seguimiento en el checkout local `main` (atrasado respecto de `origin/main`); el commit auditado se tomó de `origin/main`.
