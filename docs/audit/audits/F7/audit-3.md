# Auditoría F7 — #3
- Fecha: 2026-10-11 · Commit auditado: d76355d · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Auditoría de despliegue (flujo-cierre.md): código aprobado en audit-2, sin re-ejecutar suites. ANC-11 verificada con la evidencia del humano en `2026-10-11_dev_F7_deploy_1.md` (registrada como evidencia del humano): `migrate status` contra `pooler.supabase.com`, schema `ancillaries`, 2 migraciones, "Database schema is up to date!"; smoke de seis pasos OK (Pricing.SearchOffers, GetSeatMapForOffer, ReserveSeats, seat map muestra ocupado, ReleaseSeats, sin llave ⇒ UNAUTHENTICATED code 16) contra Cloud Run, que cubre oferta → seat map → reservar → ocupado → liberar |
| Pruebas de seguridad | ✔ Health propio: `grpcurl` (proto de `grpc-health-check` del checkout principal) a `ancillaries-service-gtl24uc77a-ue.a.run.app:443` sin llave ⇒ `Code: Unauthenticated / Message: UNAUTHENTICATED`. Evidencia del humano: health con llave ⇒ `SERVING`; smoke sin llave ⇒ code 16 |
| Checklist de cierre | ✔ Smoke en Cloud Run verde; `gcloud run services describe`: Ready/ConfigurationsReady/RoutesReady `True`, revisión `ancillaries-service-00001-qzq` con 100 % del tráfico, `INVENTORY_GRPC_URL`, `PRICING_GRPC_URL`, `GRPC_TLS=true`, `INTERNAL_API_KEY` y `DATABASE_URL` por `secretKeyRef`, cuenta `ancillaries-service-runtime`. Concurrencia, seat map y seguridad: aprobados en audit-2 |
| Conformidad con el contrato | N/A (sin cambios de código desde audit-2; `d76355d` solo agrega la bitácora de despliegue) |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- ANC-11 seed: la bitácora `2026-10-11_dev_F7_deploy_1.md:11` conserva el marcador `<número de filas en ancillaries.seat_layouts>` en lugar del conteo; el resultado del seed se sostiene solo por el smoke con oferta real. El checkout principal muestra esa bitácora con cambios sin commit; no se auditó.
- ANC-11 secreto: el `describe` no muestra la política de acceso de `ancillaries-database-url` (solo ancillaries-service-runtime); la bitácora lo afirma sin salida que lo respalde.
- La salida del smoke muestra `?` en lugar de la raya en "sin llave interna ? UNAUTHENTICATED" (codificación de consola).
- El health con llave y el smoke no se repitieron: requieren la llave de Secret Manager, que el auditor no lee.
