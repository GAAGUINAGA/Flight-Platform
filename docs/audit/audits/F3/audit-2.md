# Auditoría F3 — #2
- Fecha: 2026-10-07 · Commit auditado: f0c8b65 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (`npx jest microservices/webhooks-service --runInBand` → 4 suites, 16/16; `npx jest packages/shared --runInBand` → 11/11; lint, build y `npm audit --audit-level=high` sin errores) | ✔ |
| Pruebas de seguridad (WHK-SEC-01..05) | ✔ |
| Checklist de cierre (entrega firmada, reintentos, SSRF y secreto; smoke Cloud Run excluido por flujo-cierre) | ✔ |
| Conformidad con el contrato | ✔ |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | Sin hallazgos. H1 y H2 de audit-1 verificados como resueltos: `test/integration/webhooks.spec.ts` (WHK-05) agenda 1, 5, 15, 60, 180 y 720 min y pasa a `FAILED` con `attempts: 7`; (WHK-04) casos de 0 y 2 entregas contra Postgres. |
## Observaciones (no bloquean → BACKLOG)
- Health gRPC desde contenedor no verificado por el auditor: los comandos `docker` fueron denegados en esta sesión. La bitácora del developer (`2026-10-07_dev_3_2.md`) declara `SERVING` con `PORT=8080`.
- El contenedor `fp-audit-whk` de la auditoría #1 seguía en ejecución; no pudo retirarse.
- `WebhookUrlPolicy.privateIp` no cubre `0.0.0.0`, `100.64.0.0/10` ni IPv4 mapeada en IPv6 (sin cambios respecto a audit-1).
- `secret` es opcional en `CreateSubscription` (el contrato lo exige) y el secreto generado no se devuelve en claro (sin cambios).
- WHK-06: el validador del cuerpo en `webhooks.spec.ts:17-24` es manual y no comprueba formato `date-time` ni tipo de cada campo (sin cambios).
- §2.5: la prueba de llave del servicio cubre solo ausencia de `x-internal-key`; la llave incorrecta se prueba en `packages/shared`.
- WHK-SEC-01: sin prueba de revalidación antes de cada envío ni de resolución DNS.
- Las pruebas requieren `prisma generate` y build de `@flight-platform/shared` previos.
