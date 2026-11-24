# Auditoría F12 — #54
- Fecha: 2026-11-23 · Commit auditado: b23915b83f2a415179655205fbefcc5746a04289 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ — CI Gateway: 419/419; GraphQL: 142/142; paquetes: 179/179; web: 419/422 y 420/422 en dos corridas; Gateway E2E real: 653/654 y 654/654 en dos corridas. |
| Pruebas de seguridad | ✘ — la búsqueda por PNR absorbe errores de autorización y validación de Operations; las pruebas existentes de rol, entrada, registro y redacción pasaron. |
| Checklist de cierre | ✘ — el workflow limpio de web y la primera corrida E2E real no cerraron en verde; builds, lint, codegen, bundle y audit-policy pasaron. |
| Conformidad con el contrato | ✔ — OpenAPI público y contrato de Booking sin cambios; `UNKNOWN` está documentado en `admin-v1.yaml` y la respuesta 200 valida su esquema. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-4a / decisión 9 | `platform/api-gateway/src/admin-api.ts:80-84` | El `catch` de Operations convierte también `PERMISSION_DENIED` e `INVALID_ARGUMENT` en 200 `FOUND` con `checkIn.status=UNKNOWN`; la autorización y validación dejan de fallar. |
| H2 | Checklist web / ADM-C10, A11Y-A | `npm test -w @flight-platform/web` en clon limpio | Dos corridas fallaron: 3/422 y 2/422 pruebas; `ADM-C10` y `A11Y-A` no encontraron `metric-flights` en ambas. |
| H3 | PLT-A/B, I5/I6 | `RUN_GATEWAY_REAL=true`, `GATEWAY_TRANSPORT=esb`, `npx jest platform/api-gateway/test/e2e --runInBand --silent` | La primera de dos corridas falló en la limpieza de `real-stack.e2e.spec.ts:743` (`flightInstance.deleteMany`): 1 prueba fallida, 653 aprobadas; la segunda pasó 654. |
## Observaciones (no bloquean → BACKLOG)
- `admin.test.tsx` y `a11y-admin.test.tsx` pasaron aislados (71/71); la falla de web se manifestó en la suite completa del clon limpio.
- La entrega no cambia microservicios, migraciones, contrato v2 ni forma de eventos/webhooks; la reclasificación de B-090, B-071, B-053, B-082, B-070 y B-062 coincide con PLAN §1.5.
