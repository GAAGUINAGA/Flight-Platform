# Auditoría F11 — #2
- Fecha: 2026-10-20 · Commit auditado: 2a283ea (código desplegado: 8a04130) · Veredicto: APROBADO
- Alcance: auditoría de despliegue de la entrega F11a (gateway en Render, https://flight-gateway-o37n.onrender.com), según `docs/audit/context/flujo-cierre.md`. Informe previo: audit-1 APROBADO (código). No se re-auditó el código ni se ejecutaron suites.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor (sin token, `curl.exe -i`):
- `GET /flights/v1/health` ⇒ `200 OK`, `application/json`, cuerpo `{"status":"ok"}`; cabecera `strict-transport-security: max-age=15552000; includeSubDomains`, `x-content-type-options: nosniff`.
- `GET /flights/v1/bookings` sin `Authorization` ⇒ `401`, `Content-Type: application/problem+json`, cuerpo `{"type":"https://flight-platform.dev/problems/validation_failed","title":"VALIDATION_FAILED","status":401,"code":"VALIDATION_FAILED","detail":"Authentication required"}`.
- `GET /flights/v1/bookings` con `Authorization: Bearer tokeninventado.abc.def` ⇒ `401`, `application/problem+json`, mismo cuerpo (sin diferenciar el motivo del rechazo).
- Ninguna respuesta incluye traza, nombres de clase, rutas, mensajes de `jose` ni detalles internos. `code: VALIDATION_FAILED` coincide con PLAN §1.4 (GAP-018) y con el enum del OpenAPI (`vuelos-openapi.yaml:751`).

Evidencia del humano revisada (`2026-10-20_dev_F11a_deploy_1.md`, no re-ejecutada): variables de Render (`JWT_ISSUERS` solo con el emisor de Supabase, `GRPC_TLS=true`, `NODE_ENV=production`, `VALIDATE_RESPONSES=false`), workflow del gateway en verde, 200/401/401/200 de autenticación y smoke J1 completo contra Render en la segunda ejecución. Ningún microservicio se redesplegó (`git log` del alcance: solo `platform/api-gateway`).

Evaluación de la primera ejecución del smoke (503 en search y en `POST /bookings`, `createReservation` de 6 a 7 s e `INTERNAL_ERROR`): ocurrió con servicios de Cloud Run en frío; la segunda ejecución con servicios activos pasó los siete pasos. El plan no fija un presupuesto de latencia ni exige tolerancia al arranque en frío para F11a, y el checklist de cierre de F11 («J1–J7 verdes contra el despliegue real») pertenece a la entrega completa (PLT-J3). Por PLAN §4.4 no es causa de rechazo; se registra como observación.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | Ninguno |
## Observaciones (no bloquean → BACKLOG)
- O1 (PLT-I1 / despliegue): la primera ejecución del smoke J1 contra Render falló dos veces (503 `RATE_LIMIT_EXCEEDED` en search y 503 con `Retry-After: 5` en `POST /bookings`) y los logs de reservation muestran `INTERNAL_ERROR` tras 6953 ms; el éxito dependió de repetir con servicios activos. Ya registrado como tarea 0 de F11b.
- O2 (despliegue): el token de customer real y el smoke J1 solo se evidencian en la bitácora del humano; el auditor no los reprodujo (sin tokens reales, por instrucción).
- O3 (PLT-SEC-01): la prueba S con token de customer contra `/admin` sigue pendiente para F11c, ya declarada.
