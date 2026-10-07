# Auditoría F2 — #3
- Fecha: 2026-10-07 · Commit auditado: d5140c8 (main; imagen desplegada desde 7a228a1, código de F2 auditado en 1ac509a) · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (TKT-09) | ✘ |
| Pruebas de seguridad (llamada sin llave en Cloud Run) | ✔ |
| Checklist de cierre (smoke en Cloud Run) | ✘ |
| Conformidad con el contrato | N/A |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | TKT-09 | Evidencia aportada (health ⇒ `SERVING`; llamada sin llave ⇒ `UNAUTHENTICATED`); `docs/dev/progress/2026-10-07_dev_2_2.md` solo registra smoke local | El smoke exigido (`IssueTickets`, `ListTickets`) contra Cloud Run no tiene salida registrada ni aportada |
| H2 | TKT-09 | `docs/dev/progress/2026-10-07_dev_2_1.md:10` (migración solo local, Docker); sin bitácora de despliegue de F2 | No hay evidencia de la migración aplicada en la base remota de Ticketing |
## Observaciones (no bloquean → BACKLOG)
- Evidencia propia: `gcloud run services describe ticketing-service` → `Ready=True`, revisión `00002-sbw` con 100% del tráfico, puerto `h2c` 8080, SA `ticketing-service-runtime`, `INTERNAL_API_KEY` y `DATABASE_URL` desde Secret Manager; `grpcurl` TLS sin llave a `ticketing-service-58066093285.us-east1.run.app:443` → `Unauthenticated`.
- Evidencia del humano (el auditor no leyó el secreto): health con llave ⇒ `SERVING`; llamada sin llave ⇒ `UNAUTHENTICATED`.
- La imagen desplegada se construyó desde `7a228a1`; `d5140c8` solo añade documentación.
- No existe script de smoke de Ticketing en `microservices/ticketing-service/scripts/` (solo `copy-prisma-client.cjs`).
- `1ac509a` (corrección de F2) no es ancestro de `main` según `git merge-base --is-ancestor`.
