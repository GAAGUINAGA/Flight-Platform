# Auditoría F1 — #1
- Fecha: 2026-10-07 · Commit auditado: 92563f82cdea3148da0bd731a9c1a1cece7fd23f · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (`npx jest microservices/inventory-service`, clon limpio + `npm ci`, Postgres local; 3 corridas, 74/74; `npm test` raíz 88/88; arranque local con health `SERVING`) | ✔ |
| Pruebas de seguridad (INV-SEC-01..03, suite §2.5) | ✔ |
| Checklist de cierre (U/I/C/S verdes; `build`, `lint`, `npm audit --audit-level=high` exit 0). Smoke y rechazo sin llave en Cloud Run: fuera de esta auditoría (flujo-cierre.md) | ✔ |
| Conformidad con el contrato | N/A (la fase no expone rutas REST; el contrato gRPC interno se ejerció en las pruebas y en el smoke local) |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- INV-SEC-03 / AGENTS.md: en el clon limpio, con `.env` en `microservices/inventory-service/` y sin `DATABASE_URL` exportada, `npx jest microservices/inventory-service/test/security` y `.../integration/holds` fallan con `Environment variable not found: DATABASE_URL` (`test/helpers.ts:28-31`, `loadEnv`) en lugar de fallar rápido con un mensaje claro; con la variable exportada pasan.
- INV-02: la prueba (`flights.spec.ts:19`) comprueba tablas sobre la base local ya migrada; no se aplicó la migración sobre una base vacía en esta auditoría.
- INV-14: `infra/scripts/smoke-grpc.sh` tiene 0 bytes; el smoke de Inventory está en `microservices/inventory-service/scripts/smoke.cjs` (local: 4 RPC OK y rechazo sin llave `UNAUTHENTICATED`).
- INV-13/INV-14 remotos (migración/seed Supabase, deploy y smoke Cloud Run) quedan para la auditoría de despliegue.
- `npm audit`: 20 vulnerabilidades moderadas existentes (no bloquean el umbral `high`).
