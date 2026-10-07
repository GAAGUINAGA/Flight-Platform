# Auditoría F2 — #4
- Fecha: 2026-10-07 · Commit auditado: 7c39c12 (bitácora 8ea5999) · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (TKT-09) | ✘ |
| Pruebas de seguridad (llamada sin llave en Cloud Run: `Unauthenticated`, auditoría #3) | ✔ |
| Checklist de cierre (smoke en Cloud Run) | ✘ |
| Conformidad con el contrato | N/A |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | TKT-09 | `docs/dev/progress/2026-10-07_dev_2_3.md:9` (smoke ejecutado con `127.0.0.1:18080 --insecure` en Docker local); `gcloud run services describe ticketing-service` ⇒ revisión `00002-sbw`, sin cambios | El smoke (`IssueTickets`, `ListTickets`) sigue sin ejecutarse contra Cloud Run: no hay salida remota registrada ni aportada |
| H2 | TKT-09 | `docs/dev/progress/2026-10-07_dev_2_3.md` (sin mención de migración remota); `dev_2_1.md:10` (solo local) | Sigue sin evidencia de la migración aplicada en la base remota de Ticketing |
## Observaciones (no bloquean → BACKLOG)
- `microservices/ticketing-service/scripts/smoke.cjs` existe y cubre IssueTickets, ListTickets, GetTicket y rechazo sin llave; no lee ni imprime la llave. Solo se ejecutó localmente.
- Evidencia previa (audit-3) sin cambios: health con llave `SERVING` y llamada sin llave `UNAUTHENTICATED` (aportadas por el humano); sin llave desde el auditor ⇒ `Unauthenticated`.
- `7c39c12` está en `fix/F2-smoke` y no en `main`; la imagen desplegada sigue siendo la de `7a228a1`.
