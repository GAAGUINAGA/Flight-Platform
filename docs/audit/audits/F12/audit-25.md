# Auditoría F12 — #25
- Fecha: 2026-11-12 · Commit auditado: 0d5f8f80e41b947a03f1159855b6918a1c3f45d8 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ GraphQL 111/111; Reservation real 279/279; PAG y ADM-API 37/37; Gateway real completo 968/968 en dos corridas con salida 0; CI limpio: Reservation 225/225, Gateway 304/304, GraphQL 111/111 y builds. |
| Pruebas de seguridad | ✔ JWT local prohibido en producción (J2-04), GraphQL auth, rol, JWKS, operaciones conocidas, introspección, CORS, errores y logs; suites reales y unitarias aprobadas. |
| Checklist de cierre | ✘ Se modificó un OpenAPI; lint, audit-policy, check-deploy-env y pasos de CI en clon limpio pasaron. Imágenes y recorridos locales: evidencia del humano, no repetidos por instrucción. |
| Conformidad con el contrato | ✘ El cursor de web-bookings no cumple el format: date-time del OpenAPI interno anterior. El OpenAPI público no cambió. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-1 Punto 0 / contrato | contracts/openapi/interno/admin-v1.yaml:95,270; platform/api-gateway/src/admin-api.ts:44 | El commit cambia el OpenAPI interno, pese a la restricción de no modificar contratos, y nextCursor pasa de fecha ISO a base64url compuesto, incompatible con el format: date-time original. |
## Observaciones (no bloquean → BACKLOG)
- La segunda corrida completa del Gateway informó 45 suites y 968 pruebas aprobadas, pero el proceso salió con código 1; la repetición completa posterior salió con código 0.

