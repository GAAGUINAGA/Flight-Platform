# Auditoría F1 — #2
- Fecha: 2026-10-07 · Commit auditado: 90cbfa9 (main; código de F1 auditado en 92563f8, desplegado en la revisión `inventory-service-00002-9jg`) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (INV-13, INV-14) | ✔ |
| Pruebas de seguridad (llamada sin llave en Cloud Run) | ✔ |
| Checklist de cierre (smoke verde en Cloud Run; sin llave rechazada) | ✔ |
| Conformidad con el contrato | N/A |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- Evidencia propia del auditor: `gcloud run services describe inventory-service` → `Ready=True`, revisión `00002-9jg` con 100% del tráfico, puerto `h2c` 8080, SA `inventory-service-runtime`, `INTERNAL_API_KEY` y `DATABASE_URL` desde Secret Manager; llamada gRPC TLS sin llave a `inventory-service-gtl24uc77a-ue.a.run.app:443` → `UNAUTHENTICATED` (16).
- Evidencia ejecutada por el humano (el auditor no leyó el secreto): health con llave → `SERVING`; health sin llave → `Unauthenticated`; `smoke.cjs` → QueryAvailability (4 opciones), CreateHold (HELD), GetHold (HELD), ReleaseHold (RELEASED) y sin llave → `UNAUTHENTICATED` (16).
- Migración y seed en Supabase (2 migraciones, 838 instancias) y workflow `37579818166`: tomados de `docs/dev/progress/2026-10-07_dev_1_2.md`, no reejecutados.
- INV-14 pide `infra/scripts/smoke-grpc.sh inventory` (archivo de 0 bytes); el smoke se ejecutó con `microservices/inventory-service/scripts/smoke.cjs`.
- Servicio con invocación pública (`allUsers` en `roles/run.invoker`); el acceso depende de la llave interna.
