# Auditoría F12 — #1
- Fecha: 2026-10-27 · Commit auditado: 0edb489 (código verificado `b9ca84c` P1–P5 y plataforma local, `90c9efd` P6; encima solo documentación) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle (checkout `C:\Proyectos\fp-audit`, Postgres local; clon limpio `C:\Proyectos\fp-audit-clean-f12a` en `0edb489`):
- `npm run lint` y `node scripts/audit-policy.cjs`: exit 0.
- CI desde clon limpio (`npm ci`, `prisma generate`, lint, build shared/contracts/workspace, pruebas del workflow, `audit:policy`): gateway-ci, reservation, webhooks, ancillaries, pricing, inventory, ticketing y operations, todos exit 0. `npm run gen:contracts` en el clon no produce cambios.
- Suites reales, dos corridas seguidas con resultados idénticos: gateway (`RUN_GATEWAY_REAL=true`) 26 suites, 729 passed, 1 todo; reservation (`RUN_RSV12_REAL`, `RUN_PST_REAL`, `RUN_PST_SMOKE_REAL`) 32 suites, 213 passed; webhooks 8 suites, 62 passed; inventory 8 suites, 83 passed; operations (`RUN_DCS_REAL`) 19 suites, 81 passed; ancillaries 15 suites, 57 passed (1 suite omitida, ver observación 1).
- v1: `contracts/openapi/` sin cambios respecto de `fefbb06`; los `.proto` solo tienen líneas añadidas (104 inserciones, 0 eliminaciones); ningún archivo de prueba del Gateway existente modificado.
- Revisión de código: dev-auth (scrypt con sal, señuelo anti-enumeración, bloqueo por fallos, `client_id` `[A-Za-z0-9_-]` sin forma de UUID), dueño `<clientId>~<X-User-Id>`, `booking-events` (rechaza sin secreto, HMAC sobre bytes crudos con `timingSafeEqual`, idempotente por id), endpoints públicos (solo search, seatmap, flight status, health, token, JWKS, booking-events), scopes `flights:ops`/`flights:admin`, guardas de perfil (`INTEGRATION_LOCAL`, `BOOKING_PAYMENTS_VERIFY=off`, `BOOKING_STOCK_TLS=false`, bind a 127.0.0.1 lanzan error con `NODE_ENV=production`), `.local/` e `infra/dev-keys/` ignorados por git.
- Sin procesos de Node residuales al terminar.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
1. Suite omitida en ancillaries: `microservices/ancillaries-service/test/integration/anc-10-real.spec.ts:15` (`RUN_ANC10_REAL`, exige Pricing en ejecución). Preexistente a F12a; no se ejecutó.
2. La bitácora `2026-10-26_dev_F12a_1.md` («Pruebas modificadas») afirma que ninguna prueba existente fue modificada, pero `git diff fefbb06 HEAD --diff-filter=M` lista `microservices/operations-service/test/flight-status.spec.ts`. El cambio solo añade OPS-P6-01…03; las aserciones previas están intactas.
3. `platform/api-gateway/src/v2/http.ts:40-43`: `PUT /api/v2/vuelos/promociones/contrato` con cualquier cabecera `Authorization` (aunque sea inválida o sin scope) y `porcentaje_descuento_maximo` fuera de 0–100 responde 422 antes de la autenticación y de la guarda de scope.
4. `packages/shared/src/logger.ts:3-7`: la lista de redacción no incluye las cabeceras `x-webhook-signature`, `x-api-key`, `x-user-id` ni `x-device-fingerprint`; no existe una prueba v2 de logs redactados (solo la de v1, OP-15/S).
5. `platform/api-gateway/src/v2/booking-events.controller.ts:61`: con `BOOKING_EVENTS_CLIENT_ID` sin configurar, un evento con firma válida puede apuntar a reservas de cualquier cliente.
6. `microservices/webhooks-service/src/infrastructure/security/webhook-security.ts:11`: `http` se admite en cualquier entorno distinto de producción (comportamiento previo); solo el rango 100.64.0.0/10 depende de `INTEGRATION_LOCAL`.
7. Pendientes documentados por el developer, sin impacto en este veredicto: pago pendiente en equipaje y cambio de fecha responde 422 (el contrato prevé 202; ADR-F12-04, F12b); panel de operaciones con BOOKED, CHECKED_IN y BOARDED en 0 (F12b); `docker build` de las siete imágenes y despliegue en la nube sin verificar (a cargo del humano, posterior a la integración local de hoy).
